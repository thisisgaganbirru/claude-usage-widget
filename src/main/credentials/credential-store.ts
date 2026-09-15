/**
 * OS-keychain credential store (phase P1a).
 *
 * Secrets (currently the captured provider session cookie) are encrypted with
 * Electron's `safeStorage`, which delegates to the platform credential store,
 * and written as opaque ciphertext files under `<userData>/credentials`.
 * This replaces the previous electron-store file whose "encryptionKey" was a
 * random install id kept in a sibling plaintext file: that is obfuscation, not
 * encryption, because anything that can read the store can read the key.
 *
 * What safeStorage actually protects against, per platform:
 *
 * - macOS: the key lives in the login Keychain and is bound to the signed app.
 *   Other applications cannot read it without the user approving a Keychain
 *   prompt. A user with the login password, or a process able to inject into
 *   this app, still can.
 *
 * - Windows: DPAPI, scoped to the current user account. This protects the
 *   secret from OTHER USERS on the machine and from offline inspection of the
 *   file, but NOT from other software running as the same user: any process
 *   with that user's token can call CryptUnprotectData on these files.
 *
 * - Linux: it depends entirely on the keyring backend picked at runtime.
 *   `gnome_libsecret` / `kwallet*` give real protection. `basic_text` means
 *   Chromium fell back to a hard-coded key, which is equivalent to plaintext;
 *   `unknown` means no backend could be determined. In both of those cases
 *   this module refuses to persist rather than pretending the secret is safe.
 *
 * In every case the threat model is "at rest, and against other users/apps".
 * Nothing here defends against an attacker already running code as this user
 * inside this app's process.
 *
 * The backend is injected so the store can be unit tested under plain node;
 * `electron` is only required inside `getCredentialStore()`.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Minimal surface of Electron's `safeStorage` that this module depends on.
 * `getSelectedStorageBackend` only exists on Linux.
 */
export interface SecureBackend {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(plain: string): Buffer;
  decryptString(data: Buffer): string;
}

export type CredentialUnavailableReason = "unavailable" | "insecure-backend";
export type CredentialSaveFailureReason = CredentialUnavailableReason | "io";

export type CredentialSaveResult =
  | { ok: true }
  | { ok: false; reason: CredentialSaveFailureReason; message: string };

export interface CredentialAvailability {
  ok: boolean;
  reason?: CredentialUnavailableReason;
  message: string;
}

export interface CredentialStore {
  /** Encrypts and atomically writes the secret. Never throws. */
  save(id: string, plaintext: string): CredentialSaveResult;
  /**
   * Returns the decrypted secret, or null when the file is missing, cannot be
   * decrypted (key rotated, different machine/user), or was tampered with.
   * Never throws, and never deletes anything on failure.
   */
  read(id: string): string | null;
  /** Deletes the ciphertext for `id` if present. Never throws. */
  remove(id: string): void;
  /** Ids currently stored, sorted. Never throws. */
  list(): string[];
  /** Whether secrets can be stored safely right now. */
  availability(): CredentialAvailability;
}

export interface CreateCredentialStoreOptions {
  backend: SecureBackend;
  baseDir: string;
  platform?: NodeJS.Platform;
}

/** File extension for ciphertext blobs. */
export const CREDENTIAL_FILE_EXTENSION = ".bin";

const TEMP_FILE_EXTENSION = ".tmp";
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Linux `safeStorage` backends that provide no real protection. `basic_text`
 * is Chromium's hard-coded-key fallback; `unknown` means it could not tell.
 */
const INSECURE_LINUX_BACKENDS = new Set(["basic_text", "unknown"]);

const UNAVAILABLE_MESSAGE =
  "Credential was not saved because OS-level encryption is unavailable on " +
  "this system. Sign in again once the system keychain is reachable.";

const INSECURE_BACKEND_MESSAGE =
  "Credential was not saved because the desktop keyring is unavailable " +
  "(no gnome-keyring or KWallet), so the secret could only be stored in " +
  "effectively plaintext form. Unlock or install a keyring and sign in again.";

const AVAILABLE_MESSAGE = "OS-level encryption is available.";

/**
 * Restricts an id to `[A-Za-z0-9_-]` so a crafted id (`../../.ssh/id_rsa`,
 * `..\\..\\x`, an absolute path) can never address a file outside the base
 * directory. Every other character collapses to `_`, which also flattens
 * `..` to `__`. Returns "" for an id with nothing usable in it.
 */
export function sanitizeCredentialId(id: string): string {
  if (typeof id !== "string") return "";
  const sanitized = id.replace(/[^A-Za-z0-9_-]/g, "_");
  return /[A-Za-z0-9]/.test(sanitized) ? sanitized : "";
}

function isInsecureLinuxBackend(
  backend: SecureBackend,
  platform: NodeJS.Platform,
): boolean {
  if (platform !== "linux") return false;
  if (typeof backend.getSelectedStorageBackend !== "function") return false;
  let selected: string;
  try {
    selected = backend.getSelectedStorageBackend();
  } catch {
    // Treat an unusable probe the same as an unknown backend.
    return true;
  }
  return INSECURE_LINUX_BACKENDS.has(selected);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCredentialStore(
  options: CreateCredentialStoreOptions,
): CredentialStore {
  const { backend, baseDir } = options;
  const platform = options.platform ?? process.platform;
  const isWindows = platform === "win32";

  function filePathFor(sanitizedId: string): string {
    return path.join(baseDir, `${sanitizedId}${CREDENTIAL_FILE_EXTENSION}`);
  }

  function ensureBaseDir(): void {
    fs.mkdirSync(baseDir, { recursive: true, mode: DIRECTORY_MODE });
    if (!isWindows) {
      // mkdir's mode is masked by umask, and the directory may predate this
      // version, so pin the permissions explicitly.
      fs.chmodSync(baseDir, DIRECTORY_MODE);
    }
  }

  function availability(): CredentialAvailability {
    let encryptionAvailable: boolean;
    try {
      encryptionAvailable = backend.isEncryptionAvailable();
    } catch {
      encryptionAvailable = false;
    }
    if (!encryptionAvailable) {
      return {
        ok: false,
        reason: "unavailable",
        message: UNAVAILABLE_MESSAGE,
      };
    }
    if (isInsecureLinuxBackend(backend, platform)) {
      return {
        ok: false,
        reason: "insecure-backend",
        message: INSECURE_BACKEND_MESSAGE,
      };
    }
    return { ok: true, message: AVAILABLE_MESSAGE };
  }

  function save(id: string, plaintext: string): CredentialSaveResult {
    const status = availability();
    if (!status.ok) {
      // Never fall back to writing the secret in the clear.
      return {
        ok: false,
        reason: status.reason ?? "unavailable",
        message: status.message,
      };
    }

    const sanitizedId = sanitizeCredentialId(id);
    if (!sanitizedId) {
      return {
        ok: false,
        reason: "io",
        message: `Refusing to store a credential under an unusable id: "${id}".`,
      };
    }

    const target = filePathFor(sanitizedId);
    const tempPath = `${target}${TEMP_FILE_EXTENSION}`;
    try {
      ensureBaseDir();
      const ciphertext = backend.encryptString(plaintext);
      // Write-then-rename: a crash mid-write can only leave a stale .tmp,
      // never a truncated credential at the real path.
      fs.rmSync(tempPath, { force: true });
      fs.writeFileSync(tempPath, ciphertext, { mode: FILE_MODE });
      if (!isWindows) fs.chmodSync(tempPath, FILE_MODE);
      fs.renameSync(tempPath, target);
      return { ok: true };
    } catch (error) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // Best effort cleanup only.
      }
      return {
        ok: false,
        reason: "io",
        message: `Failed to store credential "${sanitizedId}": ${describeError(
          error,
        )}`,
      };
    }
  }

  function read(id: string): string | null {
    const sanitizedId = sanitizeCredentialId(id);
    if (!sanitizedId) return null;
    try {
      const ciphertext = fs.readFileSync(filePathFor(sanitizedId));
      if (ciphertext.length === 0) return null;
      // A decrypt failure means the key changed or the file was tampered
      // with. Report "no credential" so the caller re-authenticates, and
      // leave the file alone so the user can inspect or recover it.
      const plaintext = backend.decryptString(ciphertext);
      return typeof plaintext === "string" ? plaintext : null;
    } catch {
      return null;
    }
  }

  function remove(id: string): void {
    const sanitizedId = sanitizeCredentialId(id);
    if (!sanitizedId) return;
    const target = filePathFor(sanitizedId);
    try {
      fs.rmSync(target, { force: true });
      fs.rmSync(`${target}${TEMP_FILE_EXTENSION}`, { force: true });
    } catch {
      // Removal is best effort; a missing or locked file is not an error.
    }
  }

  function list(): string[] {
    try {
      return fs
        .readdirSync(baseDir)
        .filter((entry) => entry.endsWith(CREDENTIAL_FILE_EXTENSION))
        .map((entry) =>
          entry.slice(0, entry.length - CREDENTIAL_FILE_EXTENSION.length),
        )
        .sort();
    } catch {
      return [];
    }
  }

  return { save, read, remove, list, availability };
}

/** Directory name, under Electron's userData path, holding ciphertext files. */
export const CREDENTIALS_DIR_NAME = "credentials";

interface ElectronCredentialModule {
  safeStorage: SecureBackend;
  app: { getPath(name: string): string };
}

let defaultStore: CredentialStore | null = null;

/**
 * Lazily-created store for app code. `electron` is required inside the
 * function body so importing this module from a plain node/vitest process
 * never resolves it.
 */
export function getCredentialStore(): CredentialStore {
  if (defaultStore) return defaultStore;
  const { safeStorage, app } = require("electron") as ElectronCredentialModule;
  defaultStore = createCredentialStore({
    backend: safeStorage,
    baseDir: path.join(app.getPath("userData"), CREDENTIALS_DIR_NAME),
  });
  return defaultStore;
}

/** Drops the memoized default store. Intended for tests and teardown. */
export function resetCredentialStore(): void {
  defaultStore = null;
}
