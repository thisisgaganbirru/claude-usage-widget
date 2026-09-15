import { app, BrowserWindow, Notification, globalShortcut } from "electron";
import { UsagePoller } from "@main/data/usage-poller";
import { openLoginWindow } from "@main/auth/login-window";
import {
  SessionManager,
  clearAllSessions,
  clearSession,
  clearSessionCookies,
  isLoggedIn,
  listAccounts,
  setActiveAccount,
} from "@main/auth/session-manager";
import { clearOrgIdCache } from "@main/data/usage-fetcher";
import { createLogger } from "@main/logging/logger";
import { openExternalFromAllowlist } from "@main/security/policy";
import { SettingsManager } from "@main/settings/settings-manager";
import { createIpcRegistrar, type IpcRegistrar } from "@main/ipc/typed-ipc";
import {
  isAccountId,
  isExternalUrlCandidate,
  isFiniteNumber,
  isWindowDimension,
  pickSettingsPatch,
  toOptionalProvider,
  toProvider,
} from "@main/ipc/validators";
import {
  IPC_INVOKE_CHANNELS,
  IPC_ON_CHANNELS,
  IPC_SEND_CHANNELS,
} from "@shared/ipc-channels";
import type {
  AppVersionResult,
  AuthAccountsResult,
  AuthLoginResult,
  AuthLogoutEverywhereResult,
  AuthLogoutResult,
  AuthSessionResult,
  AuthSetActiveAccountResult,
  OpenExternalResult,
  PollerIntervalResult,
  PollerStateResult,
  SettingsUpdateResult,
  UsageCurrentResult,
  WindowPinnedResult,
  WindowResizeResult,
  WindowSetPinnedResult,
} from "@shared/ipc-contract";
import {
  AuthExpiredEvent,
  ProviderType,
  ThresholdCrossedEvent,
} from "@shared/types";
import {
  POLLING_INTERVAL_MAX_SEC,
  POLLING_INTERVAL_MIN_SEC,
} from "@main/settings/normalize";

const log = createLogger("ipc:handlers");

/**
 * Window operations the IPC layer is allowed to perform. The window itself is
 * owned by src/main/index.ts, which passes in only these four capabilities, so
 * a handler cannot reach for the rest of the BrowserWindow API.
 */
export interface WindowControls {
  resize(width: number, height: number): WindowResizeResult;
  getPinned(): boolean;
  setPinned(pinned: boolean): boolean;
  setIgnoreMouseEvents(ignore: boolean): void;
}

let usagePoller: UsagePoller | null = null;
let registeredQuickEntryShortcut: string | null = null;
let isWillQuitCleanupHooked = false;
let activeRegistrar: IpcRegistrar | null = null;
let arePollerListenersAttached = false;

function registerQuickEntryShortcut(
  shortcut: string,
  mainWindow: BrowserWindow,
): void {
  const normalized = shortcut.trim();
  if (!normalized) return;

  if (
    registeredQuickEntryShortcut &&
    registeredQuickEntryShortcut !== normalized &&
    globalShortcut.isRegistered(registeredQuickEntryShortcut)
  ) {
    globalShortcut.unregister(registeredQuickEntryShortcut);
    registeredQuickEntryShortcut = null;
  }

  if (
    registeredQuickEntryShortcut === normalized &&
    globalShortcut.isRegistered(normalized)
  ) {
    return;
  }

  const ok = globalShortcut.register(normalized, () => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  if (ok) {
    registeredQuickEntryShortcut = normalized;
  } else {
    log.warn("failed to register quick-entry shortcut", {
      shortcut: normalized,
    });
  }
}

export function cleanupGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
  registeredQuickEntryShortcut = null;
}

function showThresholdNotification(event: ThresholdCrossedEvent): void {
  if (!Notification.isSupported()) return;

  const roundedUsage = Math.round(event.percentage);
  const providerLabel = event.provider === "chatgpt" ? "ChatGPT" : "Claude";
  const body =
    event.scope === "weekly"
      ? `Your weekly limit crossed ${event.threshold}%. Use wisely.`
      : `Current session usage reached ${roundedUsage}% (alert threshold ${event.threshold}%).`;

  const notification = new Notification({
    title: `${providerLabel} Usage Alert`,
    body,
    silent: false,
  });
  notification.show();
}

/**
 * Wire the poller's events to whichever window is current. The listeners are
 * attached once for the process lifetime and read `activeRegistrar`, so a
 * window recreated on `activate` does not stack a second set of listeners on
 * the same poller.
 */
function attachPollerListeners(poller: UsagePoller): void {
  if (arePollerListenersAttached) return;
  arePollerListenersAttached = true;

  poller.on("usageUpdate", (usageData) => {
    activeRegistrar?.send(IPC_ON_CHANNELS.USAGE_UPDATED, { usageData });
  });

  poller.on("thresholdCrossed", (event: ThresholdCrossedEvent) => {
    const settings = SettingsManager.get();
    if (settings.enableBannerNotifications) {
      activeRegistrar?.send(IPC_ON_CHANNELS.NOTIFICATION_THRESHOLD, event);
    }
    if (settings.enableDesktopNotifications) {
      showThresholdNotification(event);
    }
  });

  poller.on("authExpired", (event: AuthExpiredEvent) => {
    activeRegistrar?.send(IPC_ON_CHANNELS.AUTH_EXPIRED, event);
  });

  poller.on("pollError", (event: { provider: ProviderType; error: Error }) => {
    activeRegistrar?.send(IPC_ON_CHANNELS.POLLER_ERROR, {
      provider: event.provider,
      error: event.error.message,
    });
  });
}

/**
 * Register every handler on `mainWindow`. Safe to call again for a replacement
 * window: the previous registrar is disposed first, and handlers live on the
 * window's own WebContents rather than on the global `ipcMain`.
 */
export function registerIPCHandlers(
  mainWindow: BrowserWindow,
  poller: UsagePoller,
  windowControls: WindowControls,
  rendererOrigins: readonly string[],
): IpcRegistrar {
  usagePoller = poller;

  activeRegistrar?.dispose();
  const ipc = createIpcRegistrar(mainWindow, rendererOrigins);
  activeRegistrar = ipc;

  const initialSettings = SettingsManager.get();
  registerQuickEntryShortcut(initialSettings.quickEntryShortcut, mainWindow);

  if (!isWillQuitCleanupHooked) {
    app.on("will-quit", () => cleanupGlobalShortcuts());
    isWillQuitCleanupHooked = true;
  }

  ipc.handle(
    IPC_INVOKE_CHANNELS.AUTH_LOGIN,
    async (_event, providerInput): Promise<AuthLoginResult> => {
      const provider = toProvider(providerInput);
      log.info("login requested", { provider });

      const wasPinned = mainWindow.isAlwaysOnTop();
      if (wasPinned) mainWindow.setAlwaysOnTop(false);

      const result = await openLoginWindow(provider, () => {
        ipc.send(IPC_ON_CHANNELS.AUTH_LOGIN_WINDOW_OPENED, { provider });
      });

      if (wasPinned) {
        mainWindow.setAlwaysOnTop(true, "screen-saver");
        mainWindow.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
        });
        mainWindow.moveTop();
      }

      if (!result.success) {
        return {
          success: false,
          isAuthenticated: false,
          provider,
          reason: result.reason ?? "login_failed",
          message: result.message ?? "Login did not complete.",
        };
      }

      usagePoller?.setProvider(provider);
      if (usagePoller && !usagePoller.isActive()) usagePoller.start(provider);
      else void usagePoller?.refreshNow(provider);

      return { success: true, isAuthenticated: true, provider };
    },
  );

  /** Soft logout: forget our copy of the session, leave browser cookies alone. */
  ipc.handle(
    IPC_INVOKE_CHANNELS.AUTH_LOGOUT,
    (_event, providerInput): AuthLogoutResult => {
      const provider = toProvider(providerInput);
      log.info("logout requested", { provider });
      clearSession(provider);
      if (provider === "claude") clearOrgIdCache();
      usagePoller?.stop(provider);
      return { success: true, provider };
    },
  );

  /** Hard logout: drop every persisted session and every browser cookie. */
  ipc.handle(
    IPC_INVOKE_CHANNELS.AUTH_LOGOUT_EVERYWHERE,
    async (): Promise<AuthLogoutEverywhereResult> => {
      log.info("logout everywhere requested");
      clearAllSessions("claude");
      clearAllSessions("chatgpt");
      clearOrgIdCache();
      await clearSessionCookies("claude");
      await clearSessionCookies("chatgpt");
      usagePoller?.stop();
      return { success: true };
    },
  );

  ipc.handle(
    IPC_INVOKE_CHANNELS.AUTH_CHECK_SESSION,
    (_event, providerInput): AuthSessionResult => {
      const provider = toProvider(providerInput);
      const isAuthenticated = isLoggedIn(provider);
      if (isAuthenticated && usagePoller && !usagePoller.isActive(provider)) {
        usagePoller.start(provider);
      }
      return { provider, isAuthenticated };
    },
  );

  ipc.handle(
    IPC_INVOKE_CHANNELS.AUTH_LIST_ACCOUNTS,
    (_event, providerInput): AuthAccountsResult => {
      const provider = toOptionalProvider(providerInput);
      return { provider: provider ?? null, accounts: listAccounts(provider) };
    },
  );

  ipc.handle(
    IPC_INVOKE_CHANNELS.AUTH_SET_ACTIVE_ACCOUNT,
    (_event, providerInput, accountIdInput): AuthSetActiveAccountResult => {
      const provider = toProvider(providerInput);
      if (!isAccountId(accountIdInput)) {
        return { success: false, provider, accountId: "" };
      }
      const success = setActiveAccount(provider, accountIdInput);
      if (success) {
        usagePoller?.stop(provider);
        usagePoller?.start(provider);
      }
      return { success, provider, accountId: accountIdInput };
    },
  );

  ipc.handle(
    IPC_INVOKE_CHANNELS.USAGE_GET_CURRENT,
    (_event, providerInput): UsageCurrentResult => {
      const provider = toProvider(providerInput);
      const usageData = usagePoller?.getLastUsageData(provider) ?? null;
      return { provider, usageData };
    },
  );

  ipc.handle(
    IPC_INVOKE_CHANNELS.POLLER_START,
    (_event, providerInput): PollerStateResult => {
      const provider = toProvider(providerInput);
      if (!usagePoller) return { success: false, isActive: false };
      if (!usagePoller.isActive(provider)) usagePoller.start(provider);
      else void usagePoller.refreshNow(provider);
      return {
        success: true,
        isActive: usagePoller.isActive(provider),
        provider,
      };
    },
  );

  ipc.handle(IPC_INVOKE_CHANNELS.POLLER_STOP, (): PollerStateResult => {
    usagePoller?.stop();
    return { success: true, isActive: false };
  });

  ipc.handle(
    IPC_INVOKE_CHANNELS.POLLER_SET_INTERVAL,
    (_event, secondsInput): PollerIntervalResult => {
      if (
        !isFiniteNumber(secondsInput) ||
        secondsInput < POLLING_INTERVAL_MIN_SEC ||
        secondsInput > POLLING_INTERVAL_MAX_SEC
      ) {
        return {
          success: false,
          error: `Interval must be between ${POLLING_INTERVAL_MIN_SEC}-${POLLING_INTERVAL_MAX_SEC} seconds`,
        };
      }
      usagePoller?.setPollingInterval(secondsInput);
      return { success: true };
    },
  );

  ipc.handle(IPC_INVOKE_CHANNELS.SETTINGS_GET, () => SettingsManager.get());

  ipc.handle(
    IPC_INVOKE_CHANNELS.SETTINGS_UPDATE,
    (_event, patchInput): SettingsUpdateResult => {
      const patch = pickSettingsPatch(patchInput);
      const updated = SettingsManager.update(patch);
      if (patch.pollingInterval !== undefined && usagePoller) {
        usagePoller.setPollingInterval(updated.pollingInterval);
      }
      if (patch.quickEntryShortcut !== undefined) {
        registerQuickEntryShortcut(updated.quickEntryShortcut, mainWindow);
      }
      app.setLoginItemSettings({
        openAtLogin: updated.startOnBoot,
        name: "Claude Usage Widget",
      });
      return { success: true, settings: updated };
    },
  );

  ipc.handle(IPC_INVOKE_CHANNELS.APP_QUIT, () => {
    app.quit();
  });

  ipc.handle(IPC_INVOKE_CHANNELS.APP_MINIMIZE, () => {
    mainWindow.minimize();
  });

  ipc.handle(IPC_INVOKE_CHANNELS.APP_GET_VERSION, (): AppVersionResult => ({
    version: app.getVersion(),
  }));

  ipc.handle(
    IPC_INVOKE_CHANNELS.APP_OPEN_EXTERNAL,
    (_event, urlInput): OpenExternalResult => {
      if (!isExternalUrlCandidate(urlInput)) return { opened: false };
      return { opened: openExternalFromAllowlist(urlInput) };
    },
  );

  ipc.handle(
    IPC_INVOKE_CHANNELS.RESIZE_WINDOW,
    (_event, widthInput, heightInput): WindowResizeResult => {
      if (!isWindowDimension(widthInput) || !isWindowDimension(heightInput)) {
        return { success: false };
      }
      return windowControls.resize(widthInput, heightInput);
    },
  );

  ipc.handle(IPC_INVOKE_CHANNELS.WINDOW_GET_PINNED, (): WindowPinnedResult => ({
    pinned: windowControls.getPinned(),
  }));

  ipc.handle(
    IPC_INVOKE_CHANNELS.WINDOW_SET_PINNED,
    (_event, pinnedInput): WindowSetPinnedResult => {
      const pinned = windowControls.setPinned(Boolean(pinnedInput));
      return { success: true, pinned };
    },
  );

  ipc.on(IPC_SEND_CHANNELS.SET_IGNORE_MOUSE_EVENTS, (_event, ignoreInput) => {
    windowControls.setIgnoreMouseEvents(Boolean(ignoreInput));
  });

  attachPollerListeners(poller);

  // Kick off any provider that already has a saved session.
  if (SessionManager.hasAnySession()) {
    if (SessionManager.isAuthenticated("claude")) poller.start("claude");
    if (SessionManager.isAuthenticated("chatgpt")) poller.start("chatgpt");
  }

  return ipc;
}

export function getPoller(): UsagePoller | null {
  return usagePoller;
}
