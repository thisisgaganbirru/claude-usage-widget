import {
  app,
  ipcMain,
  BrowserWindow,
  Menu,
  Notification,
  globalShortcut,
  shell,
} from "electron";
import isDev from "electron-is-dev";
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
import { SettingsManager } from "@main/settings/settings-manager";
import {
  resetBrowserPreference,
  getPreferredBrowserName,
} from "@main/browser-preference";
import {
  IPC_CHANNELS,
  IPC_INTERNAL_CHANNELS,
  IPC_INVOKE_CHANNELS,
  IPC_ON_CHANNELS,
} from "@shared/ipc-channels";
import { AuthExpiredEvent, ProviderType, ThresholdCrossedEvent } from "@shared/types";

let usagePoller: UsagePoller | null = null;
let registeredQuickEntryShortcut: string | null = null;
let isWillQuitCleanupHooked = false;

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
    mainWindow.show();
    mainWindow.focus();
  });

  if (ok) {
    registeredQuickEntryShortcut = normalized;
  } else {
    console.warn(
      `[Settings] Failed to register quick-entry shortcut: ${normalized}`,
    );
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

function resolveProvider(input: unknown): ProviderType {
  return input === "chatgpt" ? "chatgpt" : "claude";
}

export function registerIPCHandlers(
  mainWindow: BrowserWindow,
  poller: UsagePoller,
): void {
  usagePoller = poller;
  const initialSettings = SettingsManager.get();
  registerQuickEntryShortcut(initialSettings.quickEntryShortcut, mainWindow);

  if (!isWillQuitCleanupHooked) {
    app.on("will-quit", () => cleanupGlobalShortcuts());
    isWillQuitCleanupHooked = true;
  }

  ipcMain.handle(IPC_INTERNAL_CHANNELS.GET_CHANNELS, () => IPC_CHANNELS);

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.AUTH_LOGIN,
    async (_event, providerInput?: ProviderType) => {
      const provider = resolveProvider(providerInput);
      if (isDev) console.log(`[IPC] auth:login requested for ${provider}`);

      const wasPinned = mainWindow.isAlwaysOnTop();
      if (wasPinned) mainWindow.setAlwaysOnTop(false);

      const result = await openLoginWindow(provider, () => {
        mainWindow.webContents.send(IPC_ON_CHANNELS.AUTH_LOGIN_WINDOW_OPENED, {
          provider,
        });
      });

      if (wasPinned) {
        mainWindow.setAlwaysOnTop(true, "screen-saver");
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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

  /**
   * Auth: Soft logout (keeps browser cookies/session alive)
   */
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.AUTH_LOGOUT,
    async (_event, providerInput?: ProviderType) => {
      const provider = resolveProvider(providerInput);
      if (isDev) {
        console.log(`[IPC] ${IPC_INVOKE_CHANNELS.AUTH_LOGOUT} requested for ${provider}`);
      }
      clearSession(provider);
      if (provider === "claude") clearOrgIdCache();
      usagePoller?.stop(provider);
      return { success: true, provider };
    },
  );

  /**
   * Auth: Hard logout (clear persisted session + browser cookies)
   */
  ipcMain.handle(IPC_INVOKE_CHANNELS.AUTH_LOGOUT_EVERYWHERE, async () => {
    if (isDev) {
      console.log(
        `[IPC] ${IPC_INVOKE_CHANNELS.AUTH_LOGOUT_EVERYWHERE} requested`,
      );
    }
    clearAllSessions("claude");
    clearAllSessions("chatgpt");
    clearOrgIdCache();
    await clearSessionCookies("claude");
    await clearSessionCookies("chatgpt");
    usagePoller?.stop();
    return { success: true };
  });

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.AUTH_CHECK_SESSION,
    async (_event, providerInput?: ProviderType) => {
      const provider = resolveProvider(providerInput);
      const isAuthenticated = isLoggedIn(provider);
      if (isAuthenticated && usagePoller && !usagePoller.isActive(provider)) {
        usagePoller.start(provider);
      }
      return { provider, isAuthenticated };
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.AUTH_LIST_ACCOUNTS,
    (_event, providerInput?: ProviderType) => {
      const provider =
        providerInput === "claude" || providerInput === "chatgpt"
          ? providerInput
          : undefined;
      return { provider, accounts: listAccounts(provider) };
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.AUTH_SET_ACTIVE_ACCOUNT,
    (_event, providerInput: ProviderType, accountId: string) => {
      const provider = resolveProvider(providerInput);
      const success = setActiveAccount(provider, accountId);
      if (success) {
        usagePoller?.stop(provider);
        usagePoller?.start(provider);
      }
      return { success, provider, accountId };
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.USAGE_GET_CURRENT,
    (_event, providerInput?: ProviderType) => {
      const provider = resolveProvider(providerInput);
      const usageData = usagePoller?.getLastUsageData(provider) ?? null;
      return { provider, usageData };
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.POLLER_START,
    (_event, providerInput?: ProviderType) => {
      const provider = resolveProvider(providerInput);
      if (!usagePoller) return { success: false, isActive: false };
      if (!usagePoller.isActive(provider)) usagePoller.start(provider);
      else void usagePoller.refreshNow(provider);
      return { success: true, isActive: usagePoller.isActive(provider), provider };
    },
  );

  ipcMain.handle(IPC_INVOKE_CHANNELS.POLLER_STOP, () => {
    usagePoller?.stop();
    return { success: true, isActive: false };
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.POLLER_SET_INTERVAL, (_event, seconds: number) => {
    if (seconds < 30 || seconds > 300) {
      return {
        success: false,
        error: "Interval must be between 30-300 seconds",
      };
    }
    usagePoller?.setPollingInterval(seconds);
    return { success: true };
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.SETTINGS_GET, () => SettingsManager.get());

  ipcMain.handle(IPC_INVOKE_CHANNELS.SETTINGS_UPDATE, (_event, settings) => {
    const updated = SettingsManager.update(settings);
    if (settings.pollingInterval && usagePoller) {
      usagePoller.setPollingInterval(updated.pollingInterval);
    }
    if (typeof settings.quickEntryShortcut === "string") {
      registerQuickEntryShortcut(updated.quickEntryShortcut, mainWindow);
    }
    app.setLoginItemSettings({
      openAtLogin: updated.startOnBoot,
      openAsHidden: true,
      name: "Claude Usage Widget",
    });
    return { success: true, settings: updated };
  });

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.MENU_SHOW_CONTEXT_MENU,
    (event, opts: { userName: string; planType: string; size: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const sizes = ["Small", "Medium", "Large"] as const;
      const menu = Menu.buildFromTemplate([
        { label: "View Size", enabled: false },
        ...sizes.map((s) => ({
          label: s,
          type: "radio" as const,
          checked: opts.size === s,
          click: () => win?.webContents.send(IPC_ON_CHANNELS.MENU_SIZE_CHANGE, s),
        })),
        { type: "separator" },
        {
          label: "Logout",
          click: () => win?.webContents.send(IPC_ON_CHANNELS.MENU_LOGOUT),
        },
        { type: "separator" },
        {
          label: "Remove Widget",
          click: () => app.quit(),
        },
      ]);
      menu.popup({ window: win ?? undefined });
    },
  );

  ipcMain.handle(IPC_INVOKE_CHANNELS.APP_QUIT, () => {
    app.quit();
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.APP_MINIMIZE, () => {
    mainWindow.minimize();
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.APP_GET_VERSION, () => {
    return { version: app.getVersion() };
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.APP_OPEN_EXTERNAL, (_event, url: string) => {
    const allowed = ["https://claude.ai/", "https://chatgpt.com/"];
    if (allowed.some((prefix) => url.startsWith(prefix))) {
      shell.openExternal(url);
    }
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.BROWSER_RESET_PREFERENCE, () => {
    resetBrowserPreference();
    return { success: true };
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.BROWSER_GET_PREFERENCE, () => {
    return { browserName: getPreferredBrowserName() };
  });

  usagePoller.on("usageUpdate", (usageData) => {
    mainWindow.webContents.send(IPC_ON_CHANNELS.USAGE_UPDATED, { usageData });
  });

  usagePoller.on("thresholdCrossed", (event: ThresholdCrossedEvent) => {
    const settings = SettingsManager.get();
    if (settings.enableBannerNotifications) {
      mainWindow.webContents.send(IPC_ON_CHANNELS.NOTIFICATION_THRESHOLD, event);
    }
    if (settings.enableDesktopNotifications) {
      showThresholdNotification(event);
    }
  });

  usagePoller.on("authExpired", (event: AuthExpiredEvent) => {
    mainWindow.webContents.send(IPC_ON_CHANNELS.AUTH_EXPIRED, event);
  });

  usagePoller.on("pollError", (event: { provider: ProviderType; error: Error }) => {
    mainWindow.webContents.send(IPC_ON_CHANNELS.POLLER_ERROR, {
      provider: event.provider,
      error: event.error.message,
    });
  });

  // Kick off current provider if any saved session exists.
  if (SessionManager.hasAnySession()) {
    if (SessionManager.isAuthenticated("claude")) usagePoller.start("claude");
    if (SessionManager.isAuthenticated("chatgpt")) usagePoller.start("chatgpt");
  }
}

export function getPoller(): UsagePoller | null {
  return usagePoller;
}
