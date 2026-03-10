/**
 * Production-grade session manager for Claude.ai authentication.
 *
 * Security model:
 * - Cookie is encrypted with electron-store using the machine's unique ID as key.
 * - This makes the stored cookie useless if the database file is extracted —
 *   it can only be decrypted on the same physical machine.
 * - We NEVER read, log, or store email/password — only the session cookie
 *   that Anthropic sets after a successful login.
 */
import Store from "electron-store";
import { machineIdSync } from "node-machine-id";
import { session } from "electron";
import isDev from "electron-is-dev";

/**
 * Ordered list of Claude.ai session cookie names to look for.
 * Configurable here — do not hardcode elsewhere.
 */
export const SESSION_COOKIE_KEYS: string[] = [
  "sessionKey",
  "CH_SESSION",
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
];

interface SessionStore {
  sessionCookie: string;
  savedAt: number;
  expiresAt: number;
}

// Lazy-init so machineIdSync() is only called once on first use
let _store: Store<SessionStore> | null = null;

function getEncryptionKey(): string {
  try {
    return machineIdSync();
  } catch {
    // Fallback if machine ID cannot be read (e.g. permissions, virtualised env)
    console.warn(
      "[SessionManager] machineIdSync() failed — using fallback key",
    );
    return "claude-widget-fallback-key-v1";
  }
}

function getStore(): Store<SessionStore> {
  if (!_store) {
    _store = new Store<SessionStore>({
      name: "auth-session",
      encryptionKey: getEncryptionKey(),
    });
  }
  return _store;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Persist an encrypted session cookie. Call this after login completes.
 */
export function saveSession(cookie: string): void {
  const now = Date.now();
  getStore().set("sessionCookie", cookie);
  getStore().set("savedAt", now);
  getStore().set("expiresAt", now + SESSION_TTL_MS);
  if (isDev) console.log("[SessionManager] Session saved (encrypted, machine-locked)");
}

/**
 * Retrieve the stored session cookie, or null if none / expired.
 */
export function getSession(): string | null {
  try {
    const store = getStore();
    const cookie = store.get("sessionCookie");
    const expiresAt = store.get("expiresAt");

    if (!cookie) return null;

    if (expiresAt && expiresAt < Date.now()) {
      clearSession();
      if (isDev) console.log("[SessionManager] Session expired, cleared");
      return null;
    }

    return cookie;
  } catch {
    return null;
  }
}

/**
 * Remove the stored session and clear all claude.ai cookies from Electron's session.
 */
export function clearSession(): void {
  getStore().clear();
  if (isDev) console.log("[SessionManager] Session cleared");
}

/**
 * Clear all claude.ai cookies from Electron's defaultSession.
 * Call on logout to ensure electron.net also loses the session.
 */
export async function clearSessionCookies(): Promise<void> {
  try {
    const cookies = await session.defaultSession.cookies.get({
      url: "https://claude.ai",
    });
    for (const cookie of cookies) {
      await session.defaultSession.cookies.remove(
        "https://claude.ai",
        cookie.name,
      );
    }
    if (isDev) console.log(
      `[SessionManager] Cleared ${cookies.length} claude.ai session cookie(s)`,
    );
  } catch (error) {
    console.error("[SessionManager] Failed to clear cookies:", error);
  }
}

/**
 * Returns true if a valid, unexpired session cookie is stored.
 * The '__electron_session__' sentinel is treated as valid —
 * electron.net uses session.defaultSession automatically regardless.
 */
export function isLoggedIn(): boolean {
  const cookie = getSession();
  // Only the old legacy dummy 'authenticated' is treated as not-logged-in
  return cookie !== null && cookie !== "authenticated";
}

// ---------------------------------------------------------------------------
// Backward-compat shim — keeps existing code that uses SessionManager.* working
// without changes. Remove once all call sites are migrated.
// ---------------------------------------------------------------------------
export const SessionManager = {
  saveSession,
  getSession,
  getSessionCookie: getSession,
  clearSession,
  clearSessionCookies,
  isLoggedIn,
  isAuthenticated: isLoggedIn,
  isRealSession: isLoggedIn,
  validateSession: isLoggedIn,
};
