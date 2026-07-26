/**
 * Session manager for provider/account-scoped authentication.
 *
 * Security model:
 * - Each provider account gets its own encrypted electron-store file.
 * - The account registry stores non-secret metadata only.
 * - Existing provider-only callers keep working by using the active account.
 */
import Store from "electron-store";
import { randomUUID, createHash } from "crypto";
import { session } from "electron";
import isDev from "electron-is-dev";
import { ProviderAccount, ProviderType } from "@shared/types";

const PROVIDERS: ProviderType[] = ["claude", "chatgpt"];
const DEFAULT_ACCOUNT_ID = "default";

const PROVIDER_URLS: Record<ProviderType, string[]> = {
  claude: ["https://claude.ai"],
  chatgpt: ["https://chatgpt.com", "https://openai.com"],
};

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

interface SessionStore {
  sessionCookie: string;
  savedAt: number;
  expiresAt: number;
}

interface KeyStore {
  installId: string;
}

interface AccountRegistryStore {
  accounts: ProviderAccount[];
  activeAccountByProvider: Partial<Record<ProviderType, string>>;
}

let keyStore: Store<KeyStore> | null = null;
let registryStore: Store<AccountRegistryStore> | null = null;
const sessionStores = new Map<string, Store<SessionStore>>();

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getEncryptionKey(): string {
  if (!keyStore) {
    keyStore = new Store<KeyStore>({ name: "install-id" });
  }
  let id = keyStore.get("installId");
  if (!id) {
    id = randomUUID();
    keyStore.set("installId", id);
    if (isDev) console.log("[SessionManager] Generated new install ID");
  }
  return id;
}

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

function sanitizeStoreSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getSessionStoreName(provider: ProviderType, accountId: string): string {
  return `auth-session-${provider}-${sanitizeStoreSegment(accountId)}`;
}

function getSessionStoreKey(provider: ProviderType, accountId: string): string {
  return `${provider}:${accountId}`;
}

function getSessionStore(
  provider: ProviderType,
  accountId: string,
): Store<SessionStore> {
  const key = getSessionStoreKey(provider, accountId);
  const existing = sessionStores.get(key);
  if (existing) return existing;

  const name = getSessionStoreName(provider, accountId);
  try {
    const store = new Store<SessionStore>({
      name,
      encryptionKey: getEncryptionKey(),
    });
    store.get("sessionCookie");
    sessionStores.set(key, store);
    return store;
  } catch (err) {
    console.warn(
      `[SessionManager] Auth store corrupted for ${provider}/${accountId}, wiping:`,
      err,
    );
    try {
      new Store({ name }).clear();
    } catch {}
    const store = new Store<SessionStore>({
      name,
      encryptionKey: getEncryptionKey(),
    });
    sessionStores.set(key, store);
    return store;
  }
}

function getLegacySessionStore(provider: ProviderType): Store<SessionStore> {
  return getSessionStore(provider, DEFAULT_ACCOUNT_ID);
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

  const providerAccounts = accounts.filter((account) => account.provider === provider);
  const account: ProviderAccount = {
    id: accountId,
    provider,
    displayName:
      displayName ?? `${getProviderLabel(provider)} Account ${providerAccounts.length + 1}`,
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

  const firstAccount = getAccounts().find((account) => account.provider === provider);
  if (firstAccount) {
    setActiveAccountId(provider, firstAccount.id);
    return firstAccount.id;
  }

  const legacyStore = getLegacySessionStore(provider);
  if (legacyStore.get("sessionCookie")) {
    ensureAccount(provider, DEFAULT_ACCOUNT_ID, `${getProviderLabel(provider)} Account`);
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

export function getActiveAccount(provider: ProviderType): ProviderAccount | null {
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

export function saveSession(
  cookie: string,
  provider: ProviderType,
  accountId?: string,
): ProviderAccount {
  const now = Date.now();
  const targetAccountId = accountId ?? createAccountId(provider, cookie);
  const account = ensureAccount(provider, targetAccountId);
  const store = getSessionStore(provider, targetAccountId);
  store.set("sessionCookie", cookie);
  store.set("savedAt", now);
  store.set("expiresAt", now + SESSION_TTL_MS);
  setActiveAccountId(provider, targetAccountId);
  if (isDev) {
    console.log(
      `[SessionManager] Session saved for ${provider}/${targetAccountId} (encrypted, machine-locked)`,
    );
  }
  return { ...account, isActive: true, updatedAt: now };
}

export function getSession(
  provider: ProviderType,
  accountId?: string,
): string | null {
  try {
    const targetAccountId = accountId ?? getActiveAccountId(provider);
    if (!targetAccountId) return null;

    const store = getSessionStore(provider, targetAccountId);
    const cookie = store.get("sessionCookie");
    const expiresAt = store.get("expiresAt");

    if (!cookie) return null;
    if (expiresAt && expiresAt < Date.now()) {
      clearSession(provider, targetAccountId);
      if (isDev) {
        console.log(`[SessionManager] ${provider}/${targetAccountId} session expired`);
      }
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
  getSessionStore(provider, targetAccountId).clear();
  if (isDev) {
    console.log(`[SessionManager] Session cleared for ${provider}/${targetAccountId}`);
  }
}

export function clearAllSessions(provider: ProviderType): void {
  for (const account of listAccounts(provider)) {
    getSessionStore(provider, account.id).clear();
  }
  if (isDev) {
    console.log(`[SessionManager] All sessions cleared for ${provider}`);
  }
}

export async function clearSessionCookies(provider: ProviderType): Promise<void> {
  try {
    const urls = PROVIDER_URLS[provider];
    let removed = 0;
    for (const url of urls) {
      const cookies = await session.defaultSession.cookies.get({ url });
      for (const cookie of cookies) {
        await session.defaultSession.cookies.remove(url, cookie.name);
        removed += 1;
      }
    }
    if (isDev) {
      console.log(
        `[SessionManager] Cleared ${removed} browser cookie(s) for ${provider}`,
      );
    }
  } catch (error) {
    console.error(
      `[SessionManager] Failed to clear cookies for ${provider}:`,
      error,
    );
  }
}

export function isLoggedIn(provider: ProviderType, accountId?: string): boolean {
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
