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
  return (
    url.includes("claude.ai/chats") ||
    url.includes("claude.ai/new") ||
    url.includes("claude.ai/chat/")
  );
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
export async function openLoginWindow(): Promise<LoginResult> {
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

    // -----------------------------------------------------------------------
    // Google OAuth popup handling
    // When user clicks "Continue with Google", Claude opens a popup window.
    // We use action:"allow" so Electron maintains window.opener — Google's
    // OAuth flow uses window.opener.postMessage() to return the auth token
    // to Claude.ai. Without a real opener the handshake silently fails.
    // We listen on did-create-window to apply our UA and track the popup.
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

      // Edge case: popup navigates to a post-login Claude URL
      popup.webContents.on("did-navigate", (_e, popupUrl) => {
        if (isDev) console.log("[LoginWindow] Popup navigated:", popupUrl);
        if (isPostLoginUrl(popupUrl)) {
          popup.close();
          onLoginDetected(popupUrl);
        }
      });
    });

    // -----------------------------------------------------------------------
    // Login detection
    // After a successful login Claude redirects to /chats (or /new).
    // At this point session.defaultSession already has the session cookie set.
    // -----------------------------------------------------------------------
    async function onLoginDetected(url: string): Promise<void> {
      if (resolved) return;
      resolved = true;

      if (isDev) console.log("[LoginWindow] ✅ Login detected:", url);

      const cookies = await session.defaultSession.cookies.get({
        url: "https://claude.ai",
      });

      // Try each known cookie name in priority order
      const sessionCookie = cookies.find((c) =>
        SESSION_COOKIE_KEYS.includes(c.name),
      );

      let cookieValue: string;
      if (sessionCookie) {
        cookieValue = `${sessionCookie.name}=${sessionCookie.value}`;
        if (isDev)
          console.log(
            "[LoginWindow] ✅ Session cookie captured:",
            sessionCookie.name,
          );
      } else {
        // No named cookie found — electron.net will still work because it uses
        // session.defaultSession automatically. Store a sentinel so we know
        // the user is logged in without a named cookie.
        cookieValue = "__electron_session__";
        if (isDev)
          console.log(
            "[LoginWindow] ⚠️ No named cookie matched. " +
              "Using electron session sentinel — electron.net will still authenticate.",
          );
      }

      saveSession(cookieValue);
      loginWindow.close();
      resolve({ success: true, cookie: cookieValue });
    }

    loginWindow.webContents.on("did-navigate", (_e, url) => {
      if (isDev) console.log("[LoginWindow] Navigated:", url);
      if (isPostLoginUrl(url)) onLoginDetected(url);
    });

    loginWindow.webContents.on("did-navigate-in-page", (_e, url) => {
      if (isPostLoginUrl(url)) onLoginDetected(url);
    });

    loginWindow.on("closed", () => {
      if (!resolved) {
        resolved = true;
        if (isDev)
          console.log("[LoginWindow] Window closed without completing login");
        resolve({ success: false, cookie: null });
      }
    });

    loginWindow.loadURL("https://claude.ai/login");
    if (isDev)
      console.log("[LoginWindow] Opened embedded browser for Claude.ai login");
  });
}
