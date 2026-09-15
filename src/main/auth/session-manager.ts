/**
 * Session manager for provider/account-scoped authentication.
 *
 * Security model:
 * - The session cookie is a secret and lives only in the OS-backed credential
 *   store, encrypted with safeStorage. It is never written to an
 *   electron-store file, and never logged.
 * - Everything else here is non-secret bookkeeping: which accounts exist,
 *   which one is active, and when a session was saved or expires. That stays
 *   in plain electron-store files, because pretending to encrypt it with a
 *   key sitting in a sibling file would only be theatre.
 * - Existing provider-only callers keep working by using the active account.
 *
 * Secrets written by older versions are migrated on first use and the legacy
 * files, including the plaintext install id that unlocked them, are deleted.
 */
import Store from "electron-store";
import { randomUUID, createHash } from "crypto";
import { clearVendorCookies } from "@main/auth/vendor-session";
import { getCredentialStore } from "@main/credentials/credential-store";
import type {
  CredentialSaveFailureReason,
  CredentialStore,
} from "@main/credentials/credential-store";
import {
  credentialIdForAccount,
  migrateLegacyCredentials,
} from "@main/credentials/migrate-legacy";
import { createLogger } from "@main/logging/logger";
import { ProviderAccount, ProviderType } from "@shared/types";

const log = createLogger("auth:session-manager");

const PROVIDERS: ProviderType[] = ["claude", "chatgpt"];
const DEFAULT_ACCOUNT_ID = "default";

const SESSION_COOKIE_KEYS_BY_PROVIDER: Record<ProviderType, string[]> = {
  claude: [
    "sessionKey",
    "sessionKeyV2",
    "CH_SESSION",
    "__Secure-next-auth.session-token",
    "next-auth.session-token",
  ],
  chatgpt: [
    "__Secure-next-auth.session-token",
    "next-auth.session-token",
    "__Secure-authjs.session-token",
    "authjs.session-token",
  ],
};

/** Non-secret timestamps, keyed by `<provider>:<accountId>`. */
interface SessionMetadata {
  savedAt: number;
  expiresAt: number;
}

interface SessionMetadataStore {
  sessions: Record<string, SessionMetadata>;
}

interface AccountRegistryStore {
  accounts: ProviderAccount[];
  activeAccountByProvider: Partial<Record<ProviderType, string>>;
}

export type SaveSessionResult =
  | { ok: true; account: ProviderAccount }
  | { ok: false; reason: CredentialSaveFailureReason; message: string };

let registryStore: Store<AccountRegistryStore> | null = null;
let metadataStore: Store<SessionMetadataStore> | null = null;

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getRegistryStore(): Store<AccountRegistryStore> {
  if (!registryStore) {
    registryStore = new Store<AccountRegistryStore>({
      name: "auth-accounts",
      defaults: {
        accounts: [],
        activeAccountByProvider: {},
      },
    });
  }
  return registryStore;
}

function getMetadataStore(): Store<SessionMetadataStore> {
  if (!metadataStore) {
    metadataStore = new Store<SessionMetadataStore>({
      name: "auth-session-meta",
      defaults: { sessions: {} },
    });
  }
  return metadataStore;
}

function getMetadataKey(provider: ProviderType, accountId: string): string {
  return `${provider}:${accountId}`;
}

function readMetadata(
  provider: ProviderType,
  accountId: string,
): SessionMetadata | null {
  const sessions = getMetadataStore().get("sessions", {});
  return sessions[getMetadataKey(provider, accountId)] ?? null;
}

function writeMetadata(
  provider: ProviderType,
  accountId: string,
  metadata: SessionMetadata,
): void {
  const store = getMetadataStore();
  store.set("sessions", {
    ...store.get("sessions", {}),
    [getMetadataKey(provider, accountId)]: metadata,
  });
}

function removeMetadata(provider: ProviderType, accountId: string): void {
  const store = getMetadataStore();
  const sessions = { ...store.get("sessions", {}) };
  delete sessions[getMetadataKey(provider, accountId)];
  store.set("sessions", sessions);
}

/**
 * Credential id for one account. The shape matches what the legacy file names
 * migrate to, so a migrated secret is found under the same id it always had.
 */
function getCredentialId(provider: ProviderType, accountId: string): string {
  return credentialIdForAccount(provider, accountId);
}

let migrationDone = false;

/**
 * Moves secrets out of the pre-safeStorage electron-store files, once per
 * process. Failure is not fatal: an unmigrated file is left in place so a
 * later run can still recover it, and the user is simply asked to sign in
 * again in the meantime.
 */
function runLegacyMigration(store: CredentialStore): void {
  if (migrationDone) return;
  migrationDone = true;

  let userDataDir: string;
  try {
    const { app } = require("electron") as {
      app: { getPath(name: string): string };
    };
    userDataDir = app.getPath("userData");
  } catch {
    return;
  }

  try {
    const result = migrateLegacyCredentials({ store, userDataDir });
    if (result.migrated.length > 0 || result.skipped.length > 0) {
      log.info("legacy credential migration finished", {
        migrated: result.migrated.length,
        removed: result.removed.length,
        skipped: result.skipped.length,
      });
    }
  } catch (error) {
    log.warn("legacy credential migration failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function credentials(): CredentialStore {
  const store = getCredentialStore();
  runLegacyMigration(store);
  return store;
}

function createAccountId(provider: ProviderType, cookie: string): string {
  const hash = createHash("sha256")
    .update(`${provider}:${cookie}:${Date.now()}:${randomUUID()}`)
    .digest("hex")
    .slice(0, 12);
  return `${provider}-${hash}`;
}

function getProviderLabel(provider: ProviderType): string {
  return provider === "chatgpt" ? "ChatGPT" : "Claude";
}

function getAccounts(): ProviderAccount[] {
  return getRegistryStore().get("accounts", []);
}

function writeAccounts(accounts: ProviderAccount[]): void {
  getRegistryStore().set("accounts", accounts);
}

function setActiveAccountId(provider: ProviderType, accountId: string): void {
  const store = getRegistryStore();
  store.set("activeAccountByProvider", {
    ...store.get("activeAccountByProvider", {}),
    [provider]: accountId,
  });

  const accounts = getAccounts().map((account) =>
    account.provider === provider
      ? { ...account, isActive: account.id === accountId }
      : account,
  );
  writeAccounts(accounts);
}

function ensureAccount(
  provider: ProviderType,
  accountId: string,
  displayName?: string,
): ProviderAccount {
  const now = Date.now();
  const accounts = getAccounts();
  const existing = accounts.find(
    (account) => account.provider === provider && account.id === accountId,
  );
  if (existing) {
    const updated = {
      ...existing,
      displayName: displayName ?? existing.displayName,
      updatedAt: now,
    };
    writeAccounts(
      accounts.map((account) => (account.id === accountId ? updated : account)),
    );
    return updated;
  }

  const providerAccounts = accounts.filter(
    (account) => account.provider === provider,
  );
  const account: ProviderAccount = {
    id: accountId,
    provider,
    displayName:
      displayName ??
      `${getProviderLabel(provider)} Account ${providerAccounts.length + 1}`,
    isActive: false,
    createdAt: now,
    updatedAt: now,
  };
  writeAccounts([...accounts, account]);
  return account;
}

function getActiveAccountId(provider: ProviderType): string | null {
  const store = getRegistryStore();
  const activeId = store.get("activeAccountByProvider", {})[provider];
  if (activeId) return activeId;

  const activeAccount = getAccounts().find(
    (account) => account.provider === provider && account.isActive,
  );
  if (activeAccount) return activeAccount.id;

  const firstAccount = getAccounts().find(
    (account) => account.provider === provider,
  );
  if (firstAccount) {
    setActiveAccountId(provider, firstAccount.id);
    return firstAccount.id;
  }

  // A pre-account-registry install has one secret under `<provider>-default`
  // and nothing in the registry; adopt it rather than asking for a new login.
  if (credentials().read(getCredentialId(provider, DEFAULT_ACCOUNT_ID))) {
    ensureAccount(
      provider,
      DEFAULT_ACCOUNT_ID,
      `${getProviderLabel(provider)} Account`,
    );
    setActiveAccountId(provider, DEFAULT_ACCOUNT_ID);
    return DEFAULT_ACCOUNT_ID;
  }

  return null;
}

export function getSessionCookieKeys(provider: ProviderType): string[] {
  return SESSION_COOKIE_KEYS_BY_PROVIDER[provider];
}

export function listAccounts(provider?: ProviderType): ProviderAccount[] {
  const accounts = getAccounts();
  return provider
    ? accounts.filter((account) => account.provider === provider)
    : accounts;
}

export function getActiveAccount(
  provider: ProviderType,
): ProviderAccount | null {
  const accountId = getActiveAccountId(provider);
  if (!accountId) return null;
  return (
    getAccounts().find(
      (account) => account.provider === provider && account.id === accountId,
    ) ?? null
  );
}

export function setActiveAccount(
  provider: ProviderType,
  accountId: string,
): boolean {
  const account = getAccounts().find(
    (item) => item.provider === provider && item.id === accountId,
  );
  if (!account) return false;
  setActiveAccountId(provider, accountId);
  return true;
}

/**
 * Persists a captured cookie. Returns a failure rather than throwing when the
 * OS keychain will not take the secret, because the caller has to tell the
 * user that signing in again will not help until the keyring is reachable.
 * Nothing is recorded in that case, so the app does not claim an account
 * whose secret was dropped.
 */
export function saveSession(
  cookie: string,
  provider: ProviderType,
  accountId?: string,
): SaveSessionResult {
  const now = Date.now();
  const targetAccountId = accountId ?? createAccountId(provider, cookie);
  const credentialId = getCredentialId(provider, targetAccountId);

  const saved = credentials().save(credentialId, cookie);
  if (!saved.ok) {
    log.error("session not saved", { provider, reason: saved.reason });
    return { ok: false, reason: saved.reason, message: saved.message };
  }

  const account = ensureAccount(provider, targetAccountId);
  writeMetadata(provider, targetAccountId, {
    savedAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  setActiveAccountId(provider, targetAccountId);
  log.info("session saved", { provider });
  return { ok: true, account: { ...account, isActive: true, updatedAt: now } };
}

export function getSession(
  provider: ProviderType,
  accountId?: string,
): string | null {
  try {
    const targetAccountId = accountId ?? getActiveAccountId(provider);
    if (!targetAccountId) return null;

    const cookie = credentials().read(
      getCredentialId(provider, targetAccountId),
    );
    if (!cookie) return null;

    const metadata = readMetadata(provider, targetAccountId);
    if (!metadata) {
      // A secret with no timestamps came from the pre-safeStorage store, which
      // kept them in the file the migration replaced. Start the clock now
      // rather than leaving it unbounded: the alternative is a session this
      // app never expires on its own.
      const now = Date.now();
      writeMetadata(provider, targetAccountId, {
        savedAt: now,
        expiresAt: now + SESSION_TTL_MS,
      });
      return cookie;
    }

    if (metadata.expiresAt && metadata.expiresAt < Date.now()) {
      clearSession(provider, targetAccountId);
      log.info("session expired", { provider });
      return null;
    }

    return cookie;
  } catch {
    return null;
  }
}

export function clearSession(provider: ProviderType, accountId?: string): void {
  const targetAccountId = accountId ?? getActiveAccountId(provider);
  if (!targetAccountId) return;
  credentials().remove(getCredentialId(provider, targetAccountId));
  removeMetadata(provider, targetAccountId);
  log.info("session cleared", { provider });
}

export function clearAllSessions(provider: ProviderType): void {
  const store = credentials();
  for (const account of listAccounts(provider)) {
    store.remove(getCredentialId(provider, account.id));
    removeMetadata(provider, account.id);
  }
  // The default id predates the registry, so it may hold a secret that no
  // listed account points at.
  store.remove(getCredentialId(provider, DEFAULT_ACCOUNT_ID));
  removeMetadata(provider, DEFAULT_ACCOUNT_ID);
  log.info("all sessions cleared", { provider });
}

/**
 * Drop the browser cookies backing a provider's sign-in.
 *
 * The cookies live in that vendor's own partition, never in the default
 * session, so the work belongs to `vendor-session.ts`. This wrapper stays for
 * the callers that only know about providers.
 */
export async function clearSessionCookies(
  provider: ProviderType,
): Promise<void> {
  await clearVendorCookies(provider);
}

export function isLoggedIn(
  provider: ProviderType,
  accountId?: string,
): boolean {
  const cookie = getSession(provider, accountId);
  return cookie !== null && cookie !== "authenticated";
}

export function hasAnySession(): boolean {
  return PROVIDERS.some((provider) => isLoggedIn(provider));
}

export const SessionManager = {
  saveSession: (
    cookie: string,
    provider: ProviderType = "claude",
    accountId?: string,
  ) => saveSession(cookie, provider, accountId),
  getSession: (provider: ProviderType = "claude", accountId?: string) =>
    getSession(provider, accountId),
  getSessionCookie: (provider: ProviderType = "claude", accountId?: string) =>
    getSession(provider, accountId),
  clearSession: (provider: ProviderType = "claude", accountId?: string) =>
    clearSession(provider, accountId),
  clearAllSessions: (provider: ProviderType = "claude") =>
    clearAllSessions(provider),
  clearSessionCookies: (provider: ProviderType = "claude") =>
    clearSessionCookies(provider),
  isLoggedIn: (provider: ProviderType = "claude", accountId?: string) =>
    isLoggedIn(provider, accountId),
  isAuthenticated: (provider: ProviderType = "claude", accountId?: string) =>
    isLoggedIn(provider, accountId),
  isRealSession: (provider: ProviderType = "claude", accountId?: string) =>
    isLoggedIn(provider, accountId),
  validateSession: (provider: ProviderType = "claude", accountId?: string) =>
    isLoggedIn(provider, accountId),
  listAccounts,
  getActiveAccount,
  setActiveAccount,
  hasAnySession,
};
