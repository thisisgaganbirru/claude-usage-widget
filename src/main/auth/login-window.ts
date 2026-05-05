import { BrowserWindow, session } from "electron";
import isDev from "electron-is-dev";
import { getSessionCookieKeys, saveSession } from "./session-manager";
import { LoginFailureReason, ProviderType } from "@shared/types";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

interface ProviderLoginConfig {
  provider: ProviderType;
  title: string;
  productName: string;
  loginUrl: string;
  cookieProbeUrl: string;
  allowedDomain: string;
  isPostLoginUrl: (url: string) => boolean;
}

const LOGIN_CONFIG: Record<ProviderType, ProviderLoginConfig> = {
  claude: {
    provider: "claude",
    title: "Login to Claude",
    productName: "Claude",
    loginUrl: "https://claude.ai/login",
    cookieProbeUrl: "https://claude.ai",
    allowedDomain: "claude.ai",
    isPostLoginUrl: (url: string): boolean => {
      if (!url.startsWith("https://claude.ai/")) return false;
      if (url.includes("accounts.google.com")) return false;
      if (url === "https://claude.ai/login") return false;
      if (url.startsWith("https://claude.ai/login?")) return false;
      if (url.startsWith("https://claude.ai/auth/signin")) return false;
      if (url.startsWith("https://claude.ai/auth/login")) return false;
      if (url === "https://claude.ai/auth") return false;
      if (url.startsWith("https://claude.ai/auth?")) return false;
      return true;
    },
  },
  chatgpt: {
    provider: "chatgpt",
    title: "Login to ChatGPT",
    productName: "ChatGPT",
    loginUrl: "https://chatgpt.com/auth/login",
    cookieProbeUrl: "https://chatgpt.com",
    allowedDomain: "chatgpt.com",
    isPostLoginUrl: (url: string): boolean => {
      if (!url.startsWith("https://chatgpt.com/")) return false;
      if (url.includes("accounts.google.com")) return false;
      if (url.startsWith("https://chatgpt.com/auth/login")) return false;
      if (url.startsWith("https://chatgpt.com/auth/signup")) return false;
      if (url === "https://chatgpt.com/auth") return false;
      if (url.startsWith("https://chatgpt.com/auth?")) return false;
      return true;
    },
  },
};

function getSecureWebPrefs(): Electron.WebPreferences {
  return {
    session: session.defaultSession,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  };
}

function isKnownSessionCookieName(provider: ProviderType, name: string): boolean {
  return getSessionCookieKeys(provider).includes(name);
}

function getValidSessionCookie(
  provider: ProviderType,
  cookies: Electron.Cookie[],
): Electron.Cookie | undefined {
  return cookies.find((cookie) => isKnownSessionCookieName(provider, cookie.name));
}

export interface LoginResult {
  success: boolean;
  cookie: string | null;
  reason?: LoginFailureReason;
  message?: string;
}

export async function openLoginWindow(
  provider: ProviderType,
  onWindowOpen?: () => void,
): Promise<LoginResult> {
  const config = LOGIN_CONFIG[provider];

  return new Promise((resolve) => {
    const loginWindow = new BrowserWindow({
      width: 800,
      height: 600,
      center: true,
      webPreferences: getSecureWebPrefs(),
      title: config.title,
      autoHideMenuBar: true,
    });

    loginWindow.webContents.setUserAgent(CHROME_UA);

    let resolved = false;
    let finalizing = false;
    let sawPostLoginUrl = false;
    let cookieChangedHandler:
      | ((
          event: Electron.Event,
          cookie: Electron.Cookie,
          cause: string,
          removed: boolean,
        ) => void)
      | null = null;

    loginWindow.webContents.setWindowOpenHandler(() => ({
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
    }));

    loginWindow.webContents.on("did-create-window", (popup) => {
      if (isDev) console.log(`[LoginWindow:${provider}] OAuth popup created`);
      popup.webContents.setUserAgent(CHROME_UA);
    });

    async function onLoginDetected(): Promise<void> {
      if (resolved || finalizing) return;

      const cookies = await session.defaultSession.cookies.get({
        url: config.cookieProbeUrl,
      });
      const sessionCookie = getValidSessionCookie(provider, cookies);
      if (!sessionCookie) {
        console.log(
          `[LoginWindow:${provider}] Waiting for valid auth cookie. Seen:`,
          cookies.map((c) => c.name).join(", ") || "(none)",
        );
        return;
      }

      finalizing = true;
      const cookieValue = `${sessionCookie.name}=${sessionCookie.value}`;
      console.log(
        `[LoginWindow:${provider}] Session cookie captured:`,
        sessionCookie.name,
      );

      resolved = true;
      clearInterval(cookiePoller);
      if (cookieChangedHandler) {
        session.defaultSession.cookies.off("changed", cookieChangedHandler);
        cookieChangedHandler = null;
      }

      try {
        saveSession(cookieValue, provider);
      } catch (error) {
        console.error(`[LoginWindow:${provider}] Failed to save session:`, error);
      }

      loginWindow.close();
      resolve({ success: true, cookie: cookieValue });
    }

    cookieChangedHandler = (
      _event: Electron.Event,
      cookie: Electron.Cookie,
      _cause: string,
      removed: boolean,
    ) => {
      if (resolved || removed) return;
      if (!cookie.domain?.includes(config.allowedDomain)) return;
      if (!isKnownSessionCookieName(provider, cookie.name)) return;
      onLoginDetected();
    };
    session.defaultSession.cookies.on("changed", cookieChangedHandler);

    const cookiePoller = setInterval(async () => {
      if (resolved || loginWindow.isDestroyed()) {
        clearInterval(cookiePoller);
        return;
      }

      try {
        const currentUrl = loginWindow.webContents.getURL();
        if (config.isPostLoginUrl(currentUrl)) {
          sawPostLoginUrl = true;
          onLoginDetected();
          return;
        }

        const cookies = await session.defaultSession.cookies.get({
          url: config.cookieProbeUrl,
        });
        const found = getValidSessionCookie(provider, cookies);
        if (found) onLoginDetected();
      } catch (error) {
        console.error(`[LoginWindow:${provider}] Poll error:`, error);
      }
    }, 1000);

    loginWindow.webContents.on("did-navigate", (_event, url) => {
      if (config.isPostLoginUrl(url)) {
        sawPostLoginUrl = true;
        onLoginDetected();
      }
    });

    loginWindow.webContents.on("did-navigate-in-page", (_event, url) => {
      if (config.isPostLoginUrl(url)) {
        sawPostLoginUrl = true;
        onLoginDetected();
      }
    });

    loginWindow.on("closed", () => {
      clearInterval(cookiePoller);
      if (cookieChangedHandler) {
        session.defaultSession.cookies.off("changed", cookieChangedHandler);
        cookieChangedHandler = null;
      }

      if (!resolved) {
        resolved = true;
        if (sawPostLoginUrl) {
          resolve({
            success: false,
            cookie: null,
            reason: "token_missing",
            message: `Login appeared to complete, but no ${config.productName} session token was captured.`,
          });
          return;
        }
        resolve({
          success: false,
          cookie: null,
          reason: "cancelled",
          message: "Login was cancelled before completion.",
        });
      }
    });

    loginWindow.loadURL(config.loginUrl);
    loginWindow.focus();
    onWindowOpen?.();
  });
}
