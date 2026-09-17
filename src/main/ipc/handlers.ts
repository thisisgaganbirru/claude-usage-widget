import { app, BrowserWindow, Notification, globalShortcut } from "electron";
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
import { createLogger } from "@main/logging/logger";
import { thresholdNotification } from "@main/notifications";
import { clearClaudeOrgCache } from "@main/providers/claude";
import type { Scheduler } from "@main/scheduler";
import { openExternalFromAllowlist } from "@main/security/policy";
import { SettingsManager } from "@main/settings/settings-manager";
import { createIpcRegistrar, type IpcRegistrar } from "@main/ipc/typed-ipc";
import {
  isAccountId,
  isExternalUrlCandidate,
  isWindowDimension,
  pickSettingsPatch,
  toOptionalProviderId,
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
  ProvidersRefreshResult,
  ProvidersSnapshotResult,
  ProviderStateEntry,
  SettingsUpdateResult,
  WindowPinnedResult,
  WindowResizeResult,
  WindowSetPinnedResult,
} from "@shared/ipc-contract";
import type { ThresholdCrossedEvent } from "@shared/types";
import type { ProviderId } from "@shared/usage";

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

let activeScheduler: Scheduler | null = null;
let registeredQuickEntryShortcut: string | null = null;
let isWillQuitCleanupHooked = false;
let activeRegistrar: IpcRegistrar | null = null;
let areSchedulerListenersAttached = false;

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
  const { title, body } = thresholdNotification(event);
  new Notification({ title, body, silent: false }).show();
}

/**
 * Forward scheduler events to whichever window is current. Attached once for
 * the process lifetime and reading `activeRegistrar`, so a window recreated on
 * `activate` does not stack a second set of listeners on the same scheduler.
 */
function attachSchedulerListeners(scheduler: Scheduler): void {
  if (areSchedulerListenersAttached) return;
  areSchedulerListenersAttached = true;

  scheduler.on("state", (entry: ProviderStateEntry) => {
    activeRegistrar?.send(IPC_ON_CHANNELS.PROVIDER_STATE, entry);

    // The auth store lives on a different axis from the usage cards: it drives
    // the login view, so it gets its own event rather than parsing states.
    if (entry.state.kind === "needs-auth") {
      activeRegistrar?.send(IPC_ON_CHANNELS.AUTH_EXPIRED, {
        provider: entry.providerId,
        message: entry.state.hint,
      });
    }
  });

  scheduler.on("threshold", (event: ThresholdCrossedEvent) => {
    const settings = SettingsManager.get();
    if (settings.enableBannerNotifications) {
      activeRegistrar?.send(IPC_ON_CHANNELS.NOTIFICATION_THRESHOLD, event);
    }
    if (settings.enableDesktopNotifications) {
      showThresholdNotification(event);
    }
  });
}

/**
 * Register every handler on `mainWindow`. Safe to call again for a replacement
 * window: the previous registrar is disposed first, and handlers live on the
 * window's own WebContents rather than on the global `ipcMain`.
 */
export function registerIPCHandlers(
  mainWindow: BrowserWindow,
  scheduler: Scheduler,
  windowControls: WindowControls,
  rendererOrigins: readonly string[],
): IpcRegistrar {
  activeScheduler = scheduler;

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

      // A fresh credential is worth reading straight away, and a provider the
      // scheduler had parked on needs-auth has no timer left to wait for.
      void scheduler.refresh(provider);

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
      if (provider === "claude") clearClaudeOrgCache();
      void scheduler.refresh(provider);
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
      clearClaudeOrgCache();
      await clearSessionCookies("claude");
      await clearSessionCookies("chatgpt");
      await scheduler.refresh();
      return { success: true };
    },
  );

  ipc.handle(
    IPC_INVOKE_CHANNELS.AUTH_CHECK_SESSION,
    (_event, providerInput): AuthSessionResult => {
      const provider = toProvider(providerInput);
      return { provider, isAuthenticated: isLoggedIn(provider) };
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
      if (success) void scheduler.refresh(provider);
      return { success, provider, accountId: accountIdInput };
    },
  );

  ipc.handle(
    IPC_INVOKE_CHANNELS.PROVIDERS_SNAPSHOT,
    (): ProvidersSnapshotResult => ({ providers: scheduler.snapshot() }),
  );

  ipc.handle(
    IPC_INVOKE_CHANNELS.PROVIDERS_REFRESH,
    async (_event, providerInput): Promise<ProvidersRefreshResult> => {
      const providerId = toOptionalProviderId(providerInput);
      const targets: ProviderId[] =
        providerId === undefined
          ? scheduler.snapshot().map((entry) => entry.providerId)
          : [providerId];
      await scheduler.refresh(providerId);
      return { success: true, providers: targets };
    },
  );

  ipc.handle(IPC_INVOKE_CHANNELS.SETTINGS_GET, () => SettingsManager.get());

  ipc.handle(
    IPC_INVOKE_CHANNELS.SETTINGS_UPDATE,
    (_event, patchInput): SettingsUpdateResult => {
      const patch = pickSettingsPatch(patchInput);
      const updated = SettingsManager.update(patch);

      // The scheduler re-reads settings itself; this only tells it when.
      if (patch.providers !== undefined) scheduler.applySettings();

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

  attachSchedulerListeners(scheduler);

  // A saved session is a reason to read now rather than wait out an interval.
  if (SessionManager.hasAnySession()) void scheduler.refresh();

  return ipc;
}

export function getScheduler(): Scheduler | null {
  return activeScheduler;
}
