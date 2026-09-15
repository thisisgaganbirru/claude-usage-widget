/**
 * The embedded vendor sign-in window.
 *
 * The window loads the vendor's real login page in an isolated, sandboxed
 * WebContents bound to that vendor's own cookie jar, watches for the session
 * cookie, hands it to the session manager and then destroys itself.
 *
 * What it is not allowed to do is as much of the design as what it does:
 *
 * - it navigates only to the vendor's origins and the identity providers
 *   those vendors offer, enforced by the process-wide navigation policy;
 * - it opens popups only for those identity providers, because OAuth cannot
 *   work without one;
 * - it never touches `session.defaultSession`, so a captured cookie is
 *   reachable only from the vendor partition that captured it.
 */
import { BrowserWindow } from "electron";
import { createLogger } from "@main/logging/logger";
import {
  SECURE_WEB_PREFERENCES,
  setNavigationPolicy,
} from "@main/security/policy";
import { describeUrlForLog } from "@main/security/url-policy";
import {
  CHROME_USER_AGENT,
  getLoginPolicy,
  isPostLoginUrl,
  isVendorCookieDomain,
} from "@main/auth/login-policy";
import { getVendorSession } from "@main/auth/vendor-session";
import { getSessionCookieKeys, saveSession } from "@main/auth/session-manager";
import { LoginFailureReason, ProviderType } from "@shared/types";

const log = createLogger("auth:login-window");

/** How often the cookie jar is re-read while the window is open. */
const COOKIE_POLL_INTERVAL_MS = 1000;

export interface LoginResult {
  success: boolean;
  cookie: string | null;
  reason?: LoginFailureReason;
  message?: string;
}

function findSessionCookie(
  provider: ProviderType,
  cookies: Electron.Cookie[],
): Electron.Cookie | undefined {
  const names = getSessionCookieKeys(provider);
  return cookies.find((cookie) => names.includes(cookie.name));
}

export async function openLoginWindow(
  provider: ProviderType,
  onWindowOpen?: () => void,
): Promise<LoginResult> {
  const policy = getLoginPolicy(provider);
  // Prepared before the window exists, so the window inherits the vendor
  // user agent and the hardened permission handlers.
  const vendorSession = getVendorSession(provider);

  return new Promise((resolve) => {
    const loginWindow = new BrowserWindow({
      width: 800,
      height: 600,
      center: true,
      title: policy.title,
      autoHideMenuBar: true,
      webPreferences: {
        ...SECURE_WEB_PREFERENCES,
        session: vendorSession,
      },
    });

    setNavigationPolicy(loginWindow.webContents, {
      navigate: policy.navigateOrigins,
      popup: policy.popupOrigins,
    });
    loginWindow.webContents.setUserAgent(CHROME_USER_AGENT);

    let resolved = false;
    let capturing = false;
    let sawPostLoginUrl = false;
    let cookieChangedHandler:
      | ((
          event: Electron.Event,
          cookie: Electron.Cookie,
          cause: string,
          removed: boolean,
        ) => void)
      | null = null;

    function detachWatchers(): void {
      clearInterval(cookiePoller);
      if (cookieChangedHandler) {
        vendorSession.cookies.off("changed", cookieChangedHandler);
        cookieChangedHandler = null;
      }
    }

    async function onLoginDetected(): Promise<void> {
      if (resolved || capturing) return;
      capturing = true;

      let sessionCookie: Electron.Cookie | undefined;
      try {
        for (const origin of policy.cookieOrigins) {
          const cookies = await vendorSession.cookies.get({ url: origin });
          sessionCookie = findSessionCookie(provider, cookies);
          if (sessionCookie) break;
        }
      } catch (error) {
        log.error("failed to read vendor cookies", {
          provider,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (!sessionCookie) {
        // Not an error: the vendor often navigates to the app shell a beat
        // before it sets the cookie, so this runs again on the next signal.
        capturing = false;
        return;
      }

      resolved = true;
      detachWatchers();

      const cookieValue = `${sessionCookie.name}=${sessionCookie.value}`;
      try {
        saveSession(cookieValue, provider);
        log.info("session captured", { provider });
      } catch (error) {
        log.error("failed to save captured session", {
          provider,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Destroyed rather than closed: the page has a live session in it and
      // there is no reason to let it run for however long an unload handler
      // would like.
      if (!loginWindow.isDestroyed()) loginWindow.destroy();
      resolve({ success: true, cookie: cookieValue });
    }

    function onNavigated(url: string): void {
      if (!isPostLoginUrl(policy, url)) return;
      sawPostLoginUrl = true;
      log.debug("post-login url reached", { url: describeUrlForLog(url) });
      void onLoginDetected();
    }

    cookieChangedHandler = (
      _event: Electron.Event,
      cookie: Electron.Cookie,
      _cause: string,
      removed: boolean,
    ) => {
      if (resolved || removed) return;
      if (!isVendorCookieDomain(policy, cookie.domain)) return;
      if (!getSessionCookieKeys(provider).includes(cookie.name)) return;
      void onLoginDetected();
    };
    vendorSession.cookies.on("changed", cookieChangedHandler);

    // The cookie events above are the fast path. This poll is the backstop
    // for a cookie written before the listener attached, or by a redirect
    // chain that never surfaces as a navigation in this window.
    const cookiePoller = setInterval(() => {
      if (resolved || loginWindow.isDestroyed()) {
        clearInterval(cookiePoller);
        return;
      }
      onNavigated(loginWindow.webContents.getURL());
      void onLoginDetected();
    }, COOKIE_POLL_INTERVAL_MS);

    loginWindow.webContents.on("did-navigate", (_event, url) => {
      onNavigated(url);
    });

    loginWindow.webContents.on("did-navigate-in-page", (_event, url) => {
      onNavigated(url);
    });

    loginWindow.on("closed", () => {
      detachWatchers();
      if (resolved) return;

      resolved = true;
      if (sawPostLoginUrl) {
        log.warn("login finished without a session cookie", { provider });
        resolve({
          success: false,
          cookie: null,
          reason: "token_missing",
          message: `Login appeared to complete, but no ${policy.productName} session token was captured.`,
        });
        return;
      }

      resolve({
        success: false,
        cookie: null,
        reason: "cancelled",
        message: "Login was cancelled before completion.",
      });
    });

    void loginWindow.loadURL(policy.loginUrl);
    loginWindow.focus();
    onWindowOpen?.();
  });
}
