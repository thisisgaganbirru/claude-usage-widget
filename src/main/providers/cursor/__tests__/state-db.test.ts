/**
 * The SQLite half of the Cursor reader, against real database files.
 *
 * The parsing tests next door use an injected reader, which cannot catch the
 * two things that actually go wrong here: a database in WAL mode with a live
 * sidecar, and Cursor's directory being written to. Both are checked below.
 */
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ACCESS_TOKEN_KEY, EMAIL_KEY, readStateKeys } from "../auth";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-db-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

interface StateDbOptions {
  /** Store values as BLOBs rather than TEXT, as some builds do. */
  blob?: boolean;
  /**
   * Put the database in WAL mode and leave the connection open, which is what
   * a running editor looks like: a `-wal` sidecar on disk holding rows the
   * main file does not have yet.
   */
  keepOpen?: boolean;
}

/** Connections a test left open, closed after it finishes. */
const openDbs: DatabaseSync[] = [];

afterEach(() => {
  while (openDbs.length > 0) openDbs.pop()?.close();
});

/** Builds a state.vscdb the way VS Code lays one out. */
async function writeStateDb(
  values: Record<string, string>,
  options: StateDbOptions = {},
): Promise<string> {
  const file = path.join(await tempDir(), "state.vscdb");
  const db = new DatabaseSync(file);
  if (options.keepOpen === true) db.exec("PRAGMA journal_mode = WAL");
  db.exec(
    "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
  );

  const insert = db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(values)) {
    insert.run(key, options.blob === true ? Buffer.from(value, "utf8") : value);
  }

  if (options.keepOpen === true) openDbs.push(db);
  else db.close();
  return file;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

describe("readStateKeys", () => {
  it("reads the keys it was asked for and nothing else", async () => {
    const file = await writeStateDb({
      [ACCESS_TOKEN_KEY]: "token",
      [EMAIL_KEY]: "ada@example.com",
      "workbench.colorTheme": "dark",
    });

    const found = await readStateKeys(file, [ACCESS_TOKEN_KEY, EMAIL_KEY]);

    expect(found.get(ACCESS_TOKEN_KEY)).toBe("token");
    expect(found.get(EMAIL_KEY)).toBe("ada@example.com");
    expect(found.has("workbench.colorTheme")).toBe(false);
  });

  it("reads values stored as BLOBs", async () => {
    const file = await writeStateDb(
      { [ACCESS_TOKEN_KEY]: "token" },
      { blob: true },
    );

    expect(
      (await readStateKeys(file, [ACCESS_TOKEN_KEY])).get(ACCESS_TOKEN_KEY),
    ).toBe("token");
  });

  it("reads rows that are still only in the WAL of a database in use", async () => {
    const file = await writeStateDb(
      { [ACCESS_TOKEN_KEY]: "token" },
      { keepOpen: true },
    );
    expect(await exists(`${file}-wal`)).toBe(true);
    const before = await fs.stat(file);

    const found = await readStateKeys(file, [ACCESS_TOKEN_KEY]);

    // Without copying the sidecar this comes back empty: the row is committed
    // but has not been checkpointed into the main file yet.
    expect(found.get(ACCESS_TOKEN_KEY)).toBe("token");

    const after = await fs.stat(file);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
  });

  it("leaves no shared-memory index beside an orphaned WAL", async () => {
    // What a crashed editor leaves: a main file and a -wal, no live reader.
    // A read-only open here creates a -shm inside Cursor's own directory,
    // which is the write this provider promises never to make.
    const live = await writeStateDb(
      { [ACCESS_TOKEN_KEY]: "token" },
      { keepOpen: true },
    );
    const orphan = path.join(await tempDir(), "state.vscdb");
    await fs.copyFile(live, orphan);
    await fs.copyFile(`${live}-wal`, `${orphan}-wal`);

    const found = await readStateKeys(orphan, [ACCESS_TOKEN_KEY]);

    expect(found.get(ACCESS_TOKEN_KEY)).toBe("token");
    expect(await exists(`${orphan}-shm`)).toBe(false);
  });

  it("leaves no journal behind in the directory it read", async () => {
    const file = await writeStateDb({ [ACCESS_TOKEN_KEY]: "token" });

    await readStateKeys(file, [ACCESS_TOKEN_KEY]);

    expect(await exists(`${file}-wal`)).toBe(false);
    expect(await exists(`${file}-shm`)).toBe(false);
    expect(await exists(`${file}-journal`)).toBe(false);
  });

  it("raises rather than inventing an answer for a file that is not a database", async () => {
    const file = path.join(await tempDir(), "state.vscdb");
    await fs.writeFile(file, "not a database", "utf8");

    await expect(readStateKeys(file, [ACCESS_TOKEN_KEY])).rejects.toThrow();
  });
});
