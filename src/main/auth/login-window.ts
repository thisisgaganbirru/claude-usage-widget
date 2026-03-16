/**
 * Production-grade embedded BrowserWindow login for Claude.ai.
 *
 * Why embedded BrowserWindow (NOT shell.openExternal):
 * - Claude.ai has no public OAuth API.
 * - Claude.ai does not whitelist custom protocol redirect URIs (e.g. myapp://callback).
 * - External browser cookies are sandboxed — Electron's net module cannot read them.
 * - Embedded window uses session.defaultSession, which is shared with electron.net.
 *   Cookies set by Claude.ai inside this window are immediately available for API calls.
 *
 * This is the same pattern used by VS Code (pre-GitHub OAuth), Slack desktop, and Figma desktop.
 *
 * Security rules enforced here:
 * - We NEVER read, intercept, or log email/password fields.
 * - We ONLY capture the session cookie AFTER Anthropic sets it post-login.
 * - All BrowserWindows use contextIsolation:true, nodeIntegration:false, sandbox:true.
 * - Cookie is encrypted at rest via sessionManager (machine-locked).
 */
import { BrowserWindow, session } from "electron";
import isDev from "electron-is-dev";
import { saveSession, SESSION_COOKIE_KEYS } from "./session-manager";

// Impersonate a real Chrome UA — Google's OAuth blocks Electron's default UA.
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Must be a function — session.defaultSession cannot be accessed at module load time,
// only after app is ready.
function getSecureWebPrefs(): Electron.WebPreferences {
  return {
    session: session.defaultSession,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  };
}

function isPostLoginUrl(url: string): boolean {
  if (!url.startsWith("https://claude.ai/")) return false;
  // Exclude Google OAuth pages
  if (url.includes("accounts.google.com")) return false;
  // Exclude the initial login page
  if (
    url === "https://claude.ai/login" ||
    url.startsWith("https://claude.ai/login?")
  )
    return false;
  // Exclude the auth SIGN-IN pages, but NOT /auth/callback (which is a successful OAuth return)
  if (
    url.startsWith("https://claude.ai/auth/signin") ||
    url.startsWith("https://claude.ai/auth/login") ||
    url === "https://claude.ai/auth" ||
    url.startsWith("https://claude.ai/auth?")
  )
    return false;
  // /auth/callback, /new, /chats, etc. all indicate successful login
  return true;
}

export interface LoginResult {
  success: boolean;
  cookie: string | null;
}

/**
 * Open an embedded BrowserWindow for Claude.ai login.
 *
 * Flow:
 * 1. Opens https://claude.ai/login in a 1000x700 window.
 * 2. User can log in with Google, email, or any other method Claude supports.
 * 3. Google OAuth popup is intercepted and opened in a sandboxed child window
 *    that shares session.defaultSession — so Google auth cookies flow back.
 * 4. When Claude redirects to /chats after login, we capture the session cookie
 *    and close the window.
 * 5. Cookie is saved encrypted via sessionManager.
 *
 * Resolves { success: true, cookie } on login, { success: false, cookie: null }
 * if the user closes the window without logging in.
 */
export async function openLoginWindow(
  onWindowOpen?: () => void,
): Promise<LoginResult> {
  return new Promise((resolve) => {
    const loginWindow = new BrowserWindow({
      width: 800,
      height: 600,
      center: true,
      webPreferences: getSecureWebPrefs(),
      title: "Login to Claude",
      autoHideMenuBar: true,
    });

    loginWindow.webContents.setUserAgent(CHROME_UA);

    let resolved = false;
    // Holds a reference so we can remove the listener on cleanup
    let cookieChangedHandler:
      | ((
          event: Electron.Event,
          cookie: Electron.Cookie,
          cause: string,
          removed: boolean,
        ) => void)
      | null = null;

    // -----------------------------------------------------------------------
    // Google OAuth popup handling
    // When user clicks "Continue with Google", Claude opens a popup window.
    // We use action:"allow" so Electron maintains window.opener — Google's
    // OAuth flow uses window.opener.postMessage() to return the auth token
    // to Claude.ai. Without a real opener the handshake silently fails.
    // -----------------------------------------------------------------------
    loginWindow.webContents.setWindowOpenHandler(() => {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 800,
          height: 600,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            session: session.defaultSession,
          },
        },
      };
    });

    loginWindow.webContents.on("did-create-window", (popup) => {
      if (isDev) console.log("[LoginWindow] OAuth popup created");
      popup.webContents.setUserAgent(CHROME_UA);
    });

    // -----------------------------------------------------------------------
    // Primary login detection: poll for session cookie every second.
    // Claude.ai uses client-side (SPA) navigation after OAuth — URL navigation
    // events are unreliable. Polling the cookie is the source of truth.
    // -----------------------------------------------------------------------
    async function onLoginDetected(): Promise<void> {
      if (resolved) return;
      resolved = true;
      clearInterval(cookiePoller);
      if (cookieChangedHandler) {
        session.defaultSession.cookies.off("changed", cookieChangedHandler);
        cookieChangedHandler = null;
      }

      const cookies = await session.defaultSession.cookies.get({
        url: "https://claude.ai",
      });

      const sessionCookie = cookies.find((c) =>
        SESSION_COOKIE_KEYS.includes(c.name),
      );

      let cookieValue: string;
      if (sessionCookie) {
        cookieValue = `${sessionCookie.name}=${sessionCookie.value}`;
        console.log(
          "[LoginWindow] ✅ Session cookie captured:",
          sessionCookie.name,
        );
      } else {
        // No named cookie — electron.net uses session.defaultSession automatically.
        cookieValue = "__electron_session__";
        console.log(
          "[LoginWindow] ⚠️ No named cookie found. All cookies:",
          cookies.map((c) => c.name).join(", ") || "(none)",
          "— using session sentinel",
        );
      }

      try {
        saveSession(cookieValue);
      } catch (err) {
        console.error("[LoginWindow] Failed to save session:", err);
      }
      loginWindow.close();
      resolve({ success: true, cookie: cookieValue });
    }

    // Real-time cookie change listener — fires the moment Claude.ai sets a cookie,
    // instead of waiting for the next 1-second poll tick.
    cookieChangedHandler = (
      _event: Electron.Event,
      cookie: Electron.Cookie,
      _cause: string,
      removed: boolean,
    ) => {
      if (resolved || removed) return;
      if (!cookie.domain?.includes("claude.ai")) return;
      const isSessionCookie =
        SESSION_COOKIE_KEYS.includes(cookie.name) ||
        cookie.name.toLowerCase().includes("session") ||
        cookie.name.startsWith("CH_") ||
        cookie.name.startsWith("__Secure-");
      if (isSessionCookie) {
        console.log(
          "[LoginWindow] ✅ Session cookie set (realtime):",
          cookie.name,
        );
        onLoginDetected();
      }
    };
    session.defaultSession.cookies.on("changed", cookieChangedHandler);

    // Poll every second — dual check: URL + cookies.
    // Logs always write (not gated on isDev) so main.log captures them for debugging.
    const cookiePoller = setInterval(async () => {
      if (resolved || loginWindow.isDestroyed()) {
        clearInterval(cookiePoller);
        return;
      }
      try {
        // Check 1: current URL via getURL() — always reflects SPA navigation
        const currentUrl = loginWindow.webContents.getURL();
        console.log("[LoginWindow] Poll URL:", currentUrl);

        if (isPostLoginUrl(currentUrl)) {
          console.log("[LoginWindow] ✅ Post-login URL detected:", currentUrl);
          onLoginDetected();
          return;
        }

        // Check 2: ALL cookies on claude.ai — log every name so we know what's there
        const cookies = await session.defaultSession.cookies.get({
          url: "https://claude.ai",
        });
        console.log(
          "[LoginWindow] claude.ai cookies:",
          cookies.length === 0
            ? "(none)"
            : cookies.map((c) => c.name).join(", "),
        );

        // Match known keys, anything with "session" in name, CH_ prefix, or sessionKey
        const found = cookies.find(
          (c) =>
            SESSION_COOKIE_KEYS.includes(c.name) ||
            c.name.toLowerCase().includes("session") ||
            c.name.startsWith("CH_") ||
            c.name.startsWith("__Secure-"),
        );
        if (found) {
          console.log("[LoginWindow] ✅ Session cookie found:", found.name);
          onLoginDetected();
        }
      } catch (err) {
        console.error("[LoginWindow] Poll error:", err);
      }
    }, 1000);

    // Fallback: navigation events (non-SPA redirects)
    loginWindow.webContents.on("did-navigate", (_e, url) => {
      console.log("[LoginWindow] did-navigate:", url);
      if (isPostLoginUrl(url)) onLoginDetected();
    });

    loginWindow.webContents.on("did-navigate-in-page", (_e, url) => {
      console.log("[LoginWindow] did-navigate-in-page:", url);
      if (isPostLoginUrl(url)) onLoginDetected();
    });

    loginWindow.on("closed", () => {
      clearInterval(cookiePoller);
      if (cookieChangedHandler) {
        session.defaultSession.cookies.off("changed", cookieChangedHandler);
        cookieChangedHandler = null;
      }
      if (!resolved) {
        resolved = true;
        if (isDev)
          console.log("[LoginWindow] Window closed without completing login");
        resolve({ success: false, cookie: null });
      }
    });

    loginWindow.loadURL("https://claude.ai/login");
    loginWindow.focus();
    onWindowOpen?.();
    if (isDev)
      console.log("[LoginWindow] Opened embedded browser for Claude.ai login");
  });
}
