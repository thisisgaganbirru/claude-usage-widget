/**
 * Process-wide Electron security policy.
 *
 * Everything the Electron security checklist asks for is installed from this
 * one module, so there is a single place to audit and a single place to change:
 *
 * - the renderer runs sandboxed, context-isolated and without Node;
 * - every WebContents, including ones the app never creates itself, gets
 *   navigation, popup and webview handlers bound to a parsed-origin allowlist;
 * - every Session denies permissions, devices, USB, Bluetooth and screen
 *   capture outright, since this app needs none of them;
 * - client certificate requests and TLS errors are refused rather than
 *   forwarded to a handler that might say yes.
 *
 * Callers opt a WebContents into a wider allowlist with `setNavigationPolicy`.
 * A WebContents with no registered policy may not navigate anywhere at all,
 * which is the right default for anything the app did not deliberately open.
 */
import { app, session, shell } from "electron";
import type { Session, WebContents, WebPreferences } from "electron";
import { createLogger } from "@main/logging/logger";
import {
  DEVTOOLS_ORIGIN,
  classifyExternalUrl,
  describeUrlForLog,
  isNavigationAllowed,
} from "@main/security/url-policy";

const log = createLogger("security");

/** Origins this app is willing to hand to the operating system browser. */
export const EXTERNAL_LINK_ORIGINS: readonly string[] = [
  "https://claude.ai",
  "https://chatgpt.com",
];

/**
 * WebPreferences every window in this app is created with.
 *
 * `sandbox: true` means preload scripts run in the sandboxed renderer and may
 * only use `electron` and a small polyfilled subset of Node, which is exactly
 * what the typed preload bridge needs and nothing more.
 */
export const SECURE_WEB_PREFERENCES: WebPreferences = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webviewTag: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  spellcheck: false,
};

export interface NavigationPolicy {
  /** Origins this WebContents may navigate to, as returned by `originOf`. */
  readonly navigate: readonly string[];
  /**
   * Origins allowed to open a real popup window, for OAuth flows that cannot
   * work any other way. Popups inherit the parent's navigation policy.
   */
  readonly popup?: readonly string[];
  /** Origins that, when a link targets them, open in the OS browser instead. */
  readonly external?: readonly string[];
}

const DENY_ALL: NavigationPolicy = { navigate: [] };

const policies = new WeakMap<WebContents, NavigationPolicy>();
const hardenedSessions = new WeakSet<Session>();

let policyInstalled = false;

/**
 * Register the origins a WebContents is allowed to reach. Call this before
 * the first `loadURL`, otherwise that load is a navigation to nowhere.
 */
export function setNavigationPolicy(
  contents: WebContents,
  policy: NavigationPolicy,
): void {
  policies.set(contents, policy);
}

function policyFor(contents: WebContents): NavigationPolicy {
  return policies.get(contents) ?? DENY_ALL;
}

/**
 * Turn on the OS sandbox for every renderer. Must run before the `ready`
 * event, so this is called at module scope from the main entry point.
 */
export function enableProcessSandbox(): void {
  app.enableSandbox();
}

/**
 * Deny every permission, device and capture request on a Session.
 *
 * The widget renders text and talks to the main process. It has no legitimate
 * use for a camera, a microphone, geolocation, a USB device or the screen, so
 * the answer is no before anything gets a chance to ask.
 */
export function hardenSession(target: Session): void {
  if (hardenedSessions.has(target)) return;
  hardenedSessions.add(target);

  target.setPermissionRequestHandler((contents, permission, callback) => {
    log.warn("permission request denied", {
      permission,
      url: describeUrlForLog(contents?.getURL() ?? ""),
    });
    callback(false);
  });

  target.setPermissionCheckHandler((_contents, permission) => {
    log.debug("permission check denied", { permission });
    return false;
  });

  target.setDevicePermissionHandler((details) => {
    log.warn("device permission denied", { deviceType: details.deviceType });
    return false;
  });

  target.setBluetoothPairingHandler((_details, callback) => {
    log.warn("bluetooth pairing denied");
    callback({ confirmed: false });
  });

  target.setDisplayMediaRequestHandler((_request, callback) => {
    log.warn("screen capture denied");
    callback({});
  });

  // Nothing may reach a protected USB class, on top of the blanket device deny.
  target.setUSBProtectedClassesHandler(() => []);

  // The spellchecker downloads dictionaries from Google; the widget has no
  // text input worth checking.
  target.setSpellCheckerEnabled(false);
}

function denyNavigation(
  contents: WebContents,
  url: string,
  kind: string,
): boolean {
  const policy = policyFor(contents);
  if (isNavigationAllowed(url, [...policy.navigate, DEVTOOLS_ORIGIN])) {
    return false;
  }
  log.warn("navigation blocked", { kind, url: describeUrlForLog(url) });
  return true;
}

function hardenWebContents(contents: WebContents): void {
  hardenSession(contents.session);

  contents.on("will-navigate", (event, url) => {
    if (denyNavigation(contents, url, "will-navigate")) event.preventDefault();
  });

  contents.on("will-redirect", (event, url) => {
    if (denyNavigation(contents, url, "will-redirect")) event.preventDefault();
  });

  contents.on("will-frame-navigate", (details) => {
    if (denyNavigation(contents, details.url, "will-frame-navigate")) {
      details.preventDefault();
    }
  });

  contents.setWindowOpenHandler(({ url, disposition }) => {
    const policy = policyFor(contents);

    if (isNavigationAllowed(url, policy.external ?? [])) {
      openExternalFromAllowlist(url, policy.external ?? []);
      return { action: "deny" };
    }

    if (isNavigationAllowed(url, policy.popup ?? [])) {
      log.info("popup allowed", { url: describeUrlForLog(url), disposition });
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 800,
          height: 600,
          autoHideMenuBar: true,
          webPreferences: {
            ...SECURE_WEB_PREFERENCES,
            session: contents.session,
          },
        },
      };
    }

    log.warn("window open blocked", {
      url: describeUrlForLog(url),
      disposition,
    });
    return { action: "deny" };
  });

  // A popup that was allowed above inherits the opener's policy, otherwise it
  // would be created with DENY_ALL and the OAuth flow would stall on its
  // first redirect.
  contents.on("did-create-window", (window) => {
    setNavigationPolicy(window.webContents, policyFor(contents));
  });

  // `webviewTag` is off everywhere, so an attach attempt means something is
  // wrong rather than something needs configuring.
  contents.on("will-attach-webview", (event) => {
    log.error("webview attach blocked");
    event.preventDefault();
  });

  contents.on("preload-error", (_event, preloadPath, error) => {
    log.error("preload script failed", {
      preloadPath,
      error: error.message,
    });
  });
}

/**
 * Install the policy. Safe to call more than once; only the first call binds
 * listeners. Call it at module scope, before `app.whenReady`, so no
 * WebContents can be created ahead of the handlers.
 */
export function installSecurityPolicy(): void {
  if (policyInstalled) return;
  policyInstalled = true;

  app.on("web-contents-created", (_event, contents) => {
    hardenWebContents(contents);
  });

  // Never offer a client certificate. The default behaviour is to pick the
  // first one silently, which hands an identity to whoever asked.
  app.on("select-client-certificate", (event, _contents, url, _list, cb) => {
    event.preventDefault();
    log.warn("client certificate request denied", {
      url: describeUrlForLog(url),
    });
    cb();
  });

  // An explicit refusal, so that a lenient handler cannot be added later
  // without deleting this one first.
  app.on("certificate-error", (event, _contents, url, error, _cert, cb) => {
    event.preventDefault();
    log.error("TLS certificate rejected", {
      url: describeUrlForLog(url),
      error,
    });
    cb(false);
  });
}

/** Harden the default session. Call once the app is ready. */
export function hardenDefaultSession(): void {
  hardenSession(session.defaultSession);
}

/**
 * Open a URL in the operating system browser, but only if it is https and on
 * an allowed origin. Returns whether the URL was opened.
 */
export function openExternalFromAllowlist(
  rawUrl: string,
  allowedOrigins: readonly string[] = EXTERNAL_LINK_ORIGINS,
): boolean {
  const decision = classifyExternalUrl(rawUrl, allowedOrigins);
  if (!decision.allowed) {
    log.warn("external open blocked", {
      reason: decision.reason,
      url: describeUrlForLog(rawUrl),
    });
    return false;
  }
  void shell.openExternal(decision.url);
  return true;
}
