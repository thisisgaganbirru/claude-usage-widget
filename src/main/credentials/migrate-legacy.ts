/**
 * One-way migration of legacy auth files into the OS-keychain store (P1a).
 *
 * The legacy layout, written by src/main/auth/session-manager.ts, is:
 *
 *   <userData>/auth-session-<provider>-<accountId>.json   electron-store file,
 *       "encrypted" with an install id as the key
 *   <userData>/install-id.json                            that key, in plaintext
 *
 * Because the ciphertext is only readable with the install-id key, this module
 * does not reimplement electron-store's crypto: the caller injects a
 * `readLegacySession` callback, and the default implementation lazily loads
 * electron-store and is allowed to fail (returning null) in any environment
 * where that is not possible. Everything else here is pure fs work so the
 * migration can be unit tested under plain node.
 *
 * Nothing throws: a legacy file that cannot be read or re-saved is reported as
 * skipped and left on disk untouched, so a later run can retry it.
 */
import fs from "node:fs";
import path from "node:path";
import type { CredentialStore } from "./credential-store";
import { sanitizeCredentialId } from "./credential-store";

/** Prefix of legacy per-account session files, without the userData dir. */
export const LEGACY_SESSION_FILE_PREFIX = "auth-session-";

/** Plaintext file holding the legacy electron-store "encryption key". */
export const LEGACY_INSTALL_ID_FILE = "install-id.json";

/** Key the legacy electron-store session files keep the cookie under. */
export const LEGACY_SESSION_COOKIE_KEY = "sessionCookie";

const LEGACY_SESSION_FILE_PATTERN = /^auth-session-(.+)\.json$/;

/**
 * Reads and decrypts one legacy session file. Returns null when the file is
 * missing, unreadable, or cannot be decrypted with the install id.
 */
export type ReadLegacySession = (filePath: string) => string | null;

export interface MigrateLegacyCredentialsOptions {
  store: CredentialStore;
  userDataDir: string;
  /** Override for tests; defaults to the electron-store reader below. */
  readLegacySession?: ReadLegacySession;
}

export interface MigrateLegacyCredentialsResult {
  /** Credential ids successfully written into the new store. */
  migrated: string[];
  /** Legacy file names deleted from userData. */
  removed: string[];
  /** Legacy file names left in place because migration did not succeed. */
  skipped: string[];
}

/**
 * Maps `auth-session-claude-default.json` to the credential id
 * `claude-default`, i.e. `<provider>-<accountId>`.
 */
export function credentialIdForLegacyFile(fileName: string): string | null {
  const match = LEGACY_SESSION_FILE_PATTERN.exec(fileName);
  if (!match) return null;
  const id = sanitizeCredentialId(match[1]);
  return id === "" ? null : id;
}

function listLegacySessionFiles(userDataDir: string): string[] {
  try {
    return fs
      .readdirSync(userDataDir)
      .filter((entry) => LEGACY_SESSION_FILE_PATTERN.test(entry))
      .sort();
  } catch {
    return [];
  }
}

function deleteFile(filePath: string): boolean {
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Default reader: lazily loads electron-store and the plaintext install id.
 * Allowed to fail — any problem (no electron, wrong key, corrupt JSON) yields
 * null, which the migration reports as "skipped" rather than an error.
 */
export function readLegacySessionWithElectronStore(
  filePath: string,
): string | null {
  try {
    const userDataDir = path.dirname(filePath);
    const name = path.basename(filePath, ".json");

    const installIdRaw = fs.readFileSync(
      path.join(userDataDir, LEGACY_INSTALL_ID_FILE),
      "utf8",
    );
    const parsed: unknown = JSON.parse(installIdRaw);
    const installId =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { installId?: unknown }).installId
        : undefined;
    if (typeof installId !== "string" || installId === "") return null;

    const ElectronStore = require("electron-store") as new (options: {
      cwd: string;
      name: string;
      encryptionKey: string;
    }) => { get(key: string): unknown };

    const store = new ElectronStore({
      cwd: userDataDir,
      name,
      encryptionKey: installId,
    });
    const cookie = store.get(LEGACY_SESSION_COOKIE_KEY);
    return typeof cookie === "string" && cookie !== "" ? cookie : null;
  } catch {
    return null;
  }
}

/**
 * Moves every legacy session file into `store`, deleting each one only after
 * its secret has been safely re-saved. Once no legacy session file remains,
 * the plaintext install-id file is deleted too.
 */
export function migrateLegacyCredentials(
  options: MigrateLegacyCredentialsOptions,
): MigrateLegacyCredentialsResult {
  const { store, userDataDir } = options;
  const readLegacySession =
    options.readLegacySession ?? readLegacySessionWithElectronStore;

  const migrated: string[] = [];
  const removed: string[] = [];
  const skipped: string[] = [];

  for (const fileName of listLegacySessionFiles(userDataDir)) {
    const credentialId = credentialIdForLegacyFile(fileName);
    if (!credentialId) {
      skipped.push(fileName);
      continue;
    }

    const filePath = path.join(userDataDir, fileName);
    let plaintext: string | null;
    try {
      plaintext = readLegacySession(filePath);
    } catch {
      plaintext = null;
    }
    if (typeof plaintext !== "string" || plaintext === "") {
      // Undecryptable: leave it alone so a later run (or a different key)
      // can still recover it.
      skipped.push(fileName);
      continue;
    }

    const result = store.save(credentialId, plaintext);
    if (!result.ok) {
      skipped.push(fileName);
      continue;
    }

    migrated.push(credentialId);
    if (deleteFile(filePath)) {
      removed.push(fileName);
    } else {
      skipped.push(fileName);
    }
  }

  const remaining = listLegacySessionFiles(userDataDir);
  if (removed.length > 0 && remaining.length === 0) {
    // The install id only existed to unlock those files; it is a plaintext
    // key on disk, so drop it once nothing needs it.
    const installIdPath = path.join(userDataDir, LEGACY_INSTALL_ID_FILE);
    if (fs.existsSync(installIdPath) && deleteFile(installIdPath)) {
      removed.push(LEGACY_INSTALL_ID_FILE);
    }
  }

  return { migrated, removed, skipped };
}
