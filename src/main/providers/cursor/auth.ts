/**
 * Reading Cursor's sign-in state out of `state.vscdb`.
 *
 * Cursor stores its tokens in the same SQLite `ItemTable` VS Code uses for
 * every other global key. Three rules govern how that file is touched, and
 * all three are about not damaging someone's editor:
 *
 * - **Nothing under Cursor's directory is ever written.** Not the database,
 *   not a journal, not a lock, not a shared-memory index.
 * - **A `-wal` sidecar means copy, never open.** Opening a WAL-mode database
 *   is not a read even with `readOnly: true`: SQLite creates a `-shm` file
 *   beside it to coordinate with other readers, and that lands in Cursor's
 *   own directory. Measured, not assumed — a read-only open of a database
 *   with an orphaned WAL leaves a `-shm` behind every time. Copying the file
 *   and its sidecars elsewhere avoids that, and has the second benefit of
 *   picking up rows that are committed to the WAL but not yet checkpointed
 *   into the main file, which is exactly the state a running editor leaves.
 * - **`node:sqlite` may not be there.** It is a built-in, but an experimental
 *   one, so its absence resolves to "Cursor not detected" rather than an
 *   error. That is also why nothing here imports it at module scope: a
 *   top-level import would print an experimental warning on every launch,
 *   including for people who have never installed Cursor.
 *
 * The access token never leaves the main process and never reaches a log line.
 */
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { decodeJwtClaims } from "../jwt";

export const ACCESS_TOKEN_KEY = "cursorAuth/accessToken";
export const EMAIL_KEY = "cursorAuth/cachedEmail";
export const MEMBERSHIP_KEY = "cursorAuth/stripeMembershipType";
export const SESSION_COOKIE_NAME = "WorkosCursorSessionToken";

/** Sidecars SQLite keeps beside a WAL-mode database. */
const SIDECARS = ["-wal", "-shm"] as const;

/** Longest label we render. It comes from outside. */
const MAX_LABEL_LENGTH = 64;

export interface CursorAuth {
  accessToken: string;
  /** The email Cursor cached at sign-in, or null. */
  email: string | null;
  /** "pro", "free_trial", "business": what Cursor recorded for the seat. */
  membership: string | null;
  /** The database it came from. A path, safe to log. */
  source: string;
}

/**
 * Reads the named keys out of one `ItemTable`. Injectable so the parsing and
 * candidate-walking below can be tested without a SQLite file.
 */
export type StateReader = (
  file: string,
  keys: readonly string[],
) => Promise<Map<string, string>>;

/**
 * VS Code writes `ItemTable.value` as TEXT on some builds and as a BLOB on
 * others, and a BLOB may be UTF-8 or BOM-less UTF-16LE depending on which
 * version of the editor last wrote the key. All three are read.
 */
export function decodeStateValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  if (!(value instanceof Uint8Array) || value.length === 0) return null;

  if (value.length >= 2 && value[0] === 0xff && value[1] === 0xfe) {
    return textOrNull(Buffer.from(value.subarray(2)).toString("utf16le"));
  }
  if (looksUtf16Le(value)) {
    return textOrNull(Buffer.from(value).toString("utf16le"));
  }
  return textOrNull(Buffer.from(value).toString("utf8"));
}

/** ASCII written as UTF-16LE has a zero at every odd byte. */
function looksUtf16Le(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes.length % 2 !== 0) return false;
  const sampled = Math.min(bytes.length, 64);
  for (let index = 1; index < sampled; index += 2) {
    if (bytes[index] !== 0) return false;
  }
  return true;
}

function textOrNull(text: string): string | null {
  const trimmed = text.replace(/\0+$/, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function labelOrNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim().slice(0, MAX_LABEL_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The user id Cursor's own client puts in front of the token. `sub` is
 * `auth0|user_01ABC…`; the cookie carries only the part after the bar.
 */
export function userIdFromToken(token: string): string | null {
  const claims = decodeJwtClaims(token);
  if (claims === null) return null;
  const sub = claims.sub;
  if (typeof sub !== "string" || sub.trim().length === 0) return null;
  const trimmed = sub.trim();
  const bar = trimmed.lastIndexOf("|");
  const id = bar === -1 ? trimmed : trimmed.slice(bar + 1);
  return id.length > 0 ? id : null;
}

/**
 * The cookie Cursor's web client sends: the user id and the token joined by a
 * literal `::`, percent-encoded because a raw colon pair in a cookie value is
 * not something every intermediary handles the same way.
 */
export function sessionCookie(token: string): string | null {
  const userId = userIdFromToken(token);
  if (userId === null) return null;
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(userId)}%3A%3A${token}`;
}

interface SqliteRow {
  key?: unknown;
  value?: unknown;
}

async function queryItemTable(
  file: string,
  keys: readonly string[],
  readOnly: boolean,
): Promise<Map<string, string>> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly });
  try {
    const placeholders = keys.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT key, value FROM ItemTable WHERE key IN (${placeholders})`,
      )
      .all(...keys) as SqliteRow[];

    const found = new Map<string, string>();
    for (const row of rows) {
      if (typeof row.key !== "string") continue;
      const decoded = decodeStateValue(row.value);
      if (decoded !== null) found.set(row.key, decoded);
    }
    return found;
  } finally {
    db.close();
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies the database and any sidecars somewhere we own, and reads that. The
 * copy lives in a directory `mkdtemp` creates with owner-only permissions and
 * is removed in the `finally`, so the token is never sitting in a
 * world-readable temp file.
 */
async function queryViaCopy(
  file: string,
  keys: readonly string[],
): Promise<Map<string, string>> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-state-"));
  try {
    const copy = path.join(dir, path.basename(file));
    await fs.copyFile(file, copy);
    for (const suffix of SIDECARS) {
      try {
        await fs.copyFile(`${file}${suffix}`, `${copy}${suffix}`);
      } catch {
        // A sidecar that is not there is the ordinary case.
      }
    }
    // Writable on purpose: SQLite replays the WAL into the copy, which is
    // ours to modify. The original is already closed by now.
    return await queryItemTable(copy, keys, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * The real reader. A `-wal` sidecar sends the read down the copy path before
 * SQLite is given the original at all, since opening it would write a `-shm`
 * next to it. Without one, a read-only open in place touches nothing, and any
 * failure there (a torn file, a permission problem) still falls back to a copy.
 */
export const readStateKeys: StateReader = async (file, keys) => {
  if (await fileExists(`${file}-wal`)) {
    return await queryViaCopy(file, keys);
  }
  try {
    return await queryItemTable(file, keys, true);
  } catch {
    return await queryViaCopy(file, keys);
  }
};

/**
 * The first candidate database that yields an access token, or null. A path
 * that is absent, unreadable, or holds no Cursor sign-in is not an error: it
 * means Cursor is not installed or not signed in on this machine.
 */
export async function readCursorAuth(
  candidates: readonly string[],
  reader: StateReader = readStateKeys,
): Promise<CursorAuth | null> {
  const keys = [ACCESS_TOKEN_KEY, EMAIL_KEY, MEMBERSHIP_KEY];

  for (const file of candidates) {
    let found: Map<string, string>;
    try {
      found = await reader(file, keys);
    } catch {
      continue;
    }

    const accessToken = found.get(ACCESS_TOKEN_KEY);
    if (accessToken === undefined || accessToken.length === 0) continue;

    return {
      accessToken,
      email: labelOrNull(found.get(EMAIL_KEY) ?? null),
      membership: labelOrNull(found.get(MEMBERSHIP_KEY) ?? null),
      source: file,
    };
  }
  return null;
}
