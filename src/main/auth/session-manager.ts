/**
 * Session manager for Claude.ai and ChatGPT authentication.
 *
 * Security model:
 * - Cookie is encrypted with electron-store using a per-install UUID as key.
 * - The UUID is generated once with crypto.randomUUID() and stored in a
 *   separate unencrypted store.
 * - Only session cookies are persisted.
 */
import Store from "electron-store";
import { randomUUID } from "crypto";
import { session } from "electron";
import isDev from "electron-is-dev";
import { ProviderType } from "@shared/types";

const PROVIDERS: ProviderType[] = ["claude", "chatgpt"];

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

let keyStore: Store<KeyStore> | null = null;
const stores: Partial<Record<ProviderType, Store<SessionStore>>> = {};

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

function getStoreName(provider: ProviderType): string {
  return `auth-session-${provider}`;
}

function getStore(provider: ProviderType): Store<SessionStore> {
  if (stores[provider]) return stores[provider]!;

  try {
    stores[provider] = new Store<SessionStore>({
      name: getStoreName(provider),
      encryptionKey: getEncryptionKey(),
    });
    stores[provider]!.get("sessionCookie");
  } catch (err) {
    console.warn(
      `[SessionManager] Auth store corrupted for ${provider}, wiping:`,
      err,
    );
    try {
      const wiper = new Store({ name: getStoreName(provider) });
      wiper.clear();
    } catch {}
    stores[provider] = new Store<SessionStore>({
      name: getStoreName(provider),
      encryptionKey: getEncryptionKey(),
    });
  }

  return stores[provider]!;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function getSessionCookieKeys(provider: ProviderType): string[] {
  return SESSION_COOKIE_KEYS_BY_PROVIDER[provider];
}

export function saveSession(cookie: string, provider: ProviderType): void {
  const now = Date.now();
  const store = getStore(provider);
  store.set("sessionCookie", cookie);
  store.set("savedAt", now);
  store.set("expiresAt", now + SESSION_TTL_MS);
  if (isDev) {
    console.log(
      `[SessionManager] Session saved for ${provider} (encrypted, machine-locked)`,
    );
  }
}

export function getSession(provider: ProviderType): string | null {
  try {
    const store = getStore(provider);
    const cookie = store.get("sessionCookie");
    const expiresAt = store.get("expiresAt");

    if (!cookie) return null;
    if (expiresAt && expiresAt < Date.now()) {
      clearSession(provider);
      if (isDev) console.log(`[SessionManager] ${provider} session expired`);
      return null;
    }

    return cookie;
  } catch {
    return null;
  }
}

export function clearSession(provider: ProviderType): void {
  getStore(provider).clear();
  if (isDev) console.log(`[SessionManager] Session cleared for ${provider}`);
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

export function isLoggedIn(provider: ProviderType): boolean {
  const cookie = getSession(provider);
  return cookie !== null && cookie !== "authenticated";
}

export function hasAnySession(): boolean {
  return PROVIDERS.some((provider) => isLoggedIn(provider));
}

// Backward-compat shim (defaults to Claude when provider is omitted).
export const SessionManager = {
  saveSession: (cookie: string, provider: ProviderType = "claude") =>
    saveSession(cookie, provider),
  getSession: (provider: ProviderType = "claude") => getSession(provider),
  getSessionCookie: (provider: ProviderType = "claude") => getSession(provider),
  clearSession: (provider: ProviderType = "claude") => clearSession(provider),
  clearSessionCookies: (provider: ProviderType = "claude") =>
    clearSessionCookies(provider),
  isLoggedIn: (provider: ProviderType = "claude") => isLoggedIn(provider),
  isAuthenticated: (provider: ProviderType = "claude") => isLoggedIn(provider),
  isRealSession: (provider: ProviderType = "claude") => isLoggedIn(provider),
  validateSession: (provider: ProviderType = "claude") => isLoggedIn(provider),
  hasAnySession,
};
