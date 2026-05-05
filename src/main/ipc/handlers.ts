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
  clearSession,
  clearSessionCookies,
  isLoggedIn,
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
import { ThresholdCrossedEvent } from "@shared/types";

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
  const body =
    event.scope === "weekly"
      ? `Your weekly limit crossed ${event.threshold}%. Use wisely.`
      : `Current session usage reached ${roundedUsage}% (alert threshold ${event.threshold}%).`;

  const notification = new Notification({
    title: "Claude Usage Alert",
    body,
    silent: false,
  });
  notification.show();
}

/**
 * Register all IPC event handlers
 */
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

  /**
   * Auth: Open login window
   */
  ipcMain.handle(IPC_INVOKE_CHANNELS.AUTH_LOGIN, async () => {
    if (isDev) console.log(`[IPC] ${IPC_INVOKE_CHANNELS.AUTH_LOGIN} requested`);

    // Lower always-on-top so the login window can appear above the widget.
    // The main window uses "screen-saver" level which buries any new window.
    const wasPinned = mainWindow.isAlwaysOnTop();
    if (wasPinned) mainWindow.setAlwaysOnTop(false);

    const result = await openLoginWindow(() => {
      mainWindow.webContents.send(IPC_ON_CHANNELS.AUTH_LOGIN_WINDOW_OPENED);
    });

    // Restore always-on-top after login window closes
    if (wasPinned) {
      mainWindow.setAlwaysOnTop(true, "screen-saver");
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      mainWindow.moveTop();
    }

    if (!result.success) {
      return {
        success: false,
        isAuthenticated: false,
        reason: result.reason ?? "login_failed",
        message: result.message ?? "Login did not complete.",
      };
    }

    // Login succeeded — session cookie captured and saved by loginWindow.
    // Start the poller; it will fetch usage data on its own schedule.
    if (usagePoller && !usagePoller.isActive()) {
      usagePoller.start();
    }

    return { success: true, isAuthenticated: true };
  });

  /**
   * Auth: Soft logout (keeps browser cookies/session alive)
   */
  ipcMain.handle(IPC_INVOKE_CHANNELS.AUTH_LOGOUT, async () => {
    if (isDev) console.log(`[IPC] ${IPC_INVOKE_CHANNELS.AUTH_LOGOUT} requested`);
    clearSession();
    clearOrgIdCache();
    usagePoller?.stop();
    return { success: true };
  });

  /**
   * Auth: Hard logout (clear persisted session + browser cookies)
   */
  ipcMain.handle(IPC_INVOKE_CHANNELS.AUTH_LOGOUT_EVERYWHERE, async () => {
    if (isDev) {
      console.log(
        `[IPC] ${IPC_INVOKE_CHANNELS.AUTH_LOGOUT_EVERYWHERE} requested`,
      );
    }
    clearSession();
    clearOrgIdCache();
    await clearSessionCookies();
    usagePoller?.stop();
    return { success: true };
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.AUTH_CHECK_SESSION, async () => {
    if (isDev) {
      console.log(`[IPC] ${IPC_INVOKE_CHANNELS.AUTH_CHECK_SESSION} requested`);
    }
    const hasSession = isLoggedIn();
    // Trust the stored session — no live API call needed here.
    // The poller validates on its first poll and emits auth:expired on 401/403.
    const isAuthenticated = hasSession;

    if (isAuthenticated && usagePoller && !usagePoller.isActive()) {
      usagePoller.start();
    } else if (!isAuthenticated) {
      usagePoller?.stop();
    }

    return { isAuthenticated };
  });

  /**
   * Usage: Get current usage data
   */
  ipcMain.handle(IPC_INVOKE_CHANNELS.USAGE_GET_CURRENT, () => {
    if (isDev) {
      console.log(`[IPC] ${IPC_INVOKE_CHANNELS.USAGE_GET_CURRENT} requested`);
    }
    const usageData = usagePoller?.getLastUsageData();
    return { usageData };
  });

  /**
   * Poller: Start polling
   */
  ipcMain.handle(IPC_INVOKE_CHANNELS.POLLER_START, () => {
    if (isDev) console.log(`[IPC] ${IPC_INVOKE_CHANNELS.POLLER_START} requested`);
    if (usagePoller && !usagePoller.isActive()) {
      usagePoller.start();
      return { success: true, isActive: true };
    }
    return { success: false, isActive: usagePoller?.isActive() ?? false };
  });

  /**
   * Poller: Stop polling
   */
  ipcMain.handle(IPC_INVOKE_CHANNELS.POLLER_STOP, () => {
    if (isDev) console.log(`[IPC] ${IPC_INVOKE_CHANNELS.POLLER_STOP} requested`);
    usagePoller?.stop();
    return { success: true, isActive: false };
  });

  /**
   * Poller: Set polling interval
   */
  ipcMain.handle(IPC_INVOKE_CHANNELS.POLLER_SET_INTERVAL, (_event, seconds: number) => {
    if (isDev) {
      console.log(`[IPC] ${IPC_INVOKE_CHANNELS.POLLER_SET_INTERVAL} requested:`, seconds);
    }
    if (seconds < 30 || seconds > 300) {
      return {
        success: false,
        error: "Interval must be between 30-300 seconds",
      };
    }
    usagePoller?.setPollingInterval(seconds);
    return { success: true };
  });

  /**
   * Settings: Get app settings
   */
  ipcMain.handle(IPC_INVOKE_CHANNELS.SETTINGS_GET, () => {
    if (isDev) console.log(`[IPC] ${IPC_INVOKE_CHANNELS.SETTINGS_GET} requested`);
    return SettingsManager.get();
  });

  /**
   * Settings: Update app settings
   */
  ipcMain.handle(IPC_INVOKE_CHANNELS.SETTINGS_UPDATE, (_event, settings) => {
    if (isDev) console.log(`[IPC] ${IPC_INVOKE_CHANNELS.SETTINGS_UPDATE} requested:`, settings);
    const updated = SettingsManager.update(settings);
    // Apply pollingInterval change live if poller is running
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

  /**
   * Menu: Show native OS context menu (renders outside window bounds)
   */
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

  /**
   * App: Quit
   */
  ipcMain.handle(IPC_INVOKE_CHANNELS.APP_QUIT, () => {
    if (isDev) console.log(`[IPC] ${IPC_INVOKE_CHANNELS.APP_QUIT} requested`);
    app.quit();
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.APP_MINIMIZE, () => {
    mainWindow.minimize();
  });

  /**
   * App: Get version
   */
  ipcMain.handle(IPC_INVOKE_CHANNELS.APP_GET_VERSION, () => {
    if (isDev) console.log(`[IPC] ${IPC_INVOKE_CHANNELS.APP_GET_VERSION} requested`);
    return { version: app.getVersion() };
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.APP_OPEN_EXTERNAL, (_event, url: string) => {
    const allowed = ["https://claude.ai/"];
    if (allowed.some((prefix) => url.startsWith(prefix))) {
      shell.openExternal(url);
    }
  });

  /**
   * Browser preference: reset stored choice
   */
  ipcMain.handle(IPC_INVOKE_CHANNELS.BROWSER_RESET_PREFERENCE, () => {
    resetBrowserPreference();
    return { success: true };
  });

  /**
   * Browser preference: get current browser name
   */
  ipcMain.handle(IPC_INVOKE_CHANNELS.BROWSER_GET_PREFERENCE, () => {
    return { browserName: getPreferredBrowserName() };
  });

  /**
   * Listen for poller events and forward to renderer
   */
  if (usagePoller) {
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

    usagePoller.on("authExpired", (event) => {
      mainWindow.webContents.send(IPC_ON_CHANNELS.AUTH_EXPIRED, event);
    });

    usagePoller.on("pollError", (error) => {
      mainWindow.webContents.send(IPC_ON_CHANNELS.POLLER_ERROR, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });
  }
}

/**
 * Get the current usage poller instance
 */
export function getPoller(): UsagePoller | null {
  return usagePoller;
}
