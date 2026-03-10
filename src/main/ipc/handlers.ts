import { app, ipcMain, BrowserWindow, Menu, shell } from "electron";
import isDev from "electron-is-dev";
import { UsagePoller } from "@main/data/usage-poller";
import { openLoginWindow } from "@main/auth/login-window";
import {
  getSession,
  clearSession,
  clearSessionCookies,
  isLoggedIn,
} from "@main/auth/session-manager";
import { fetchUsageData, clearOrgIdCache } from "@main/data/usage-fetcher";
import { SettingsManager } from "@main/settings/settings-manager";
import {
  resetBrowserPreference,
  getPreferredBrowserName,
} from "@main/browser-preference";

let usagePoller: UsagePoller | null = null;

/**
 * Register all IPC event handlers
 */
export function registerIPCHandlers(
  mainWindow: BrowserWindow,
  poller: UsagePoller,
): void {
  usagePoller = poller;

  /**
   * Auth: Open login window
   */
  ipcMain.handle("auth:login", async () => {
    if (isDev) console.log("[IPC] auth:login requested");
    const result = await openLoginWindow();
    if (!result.success) return { success: false, isAuthenticated: false };

    // Login succeeded — session cookie captured and saved by loginWindow.
    // Start the poller; it will fetch usage data on its own schedule.
    if (usagePoller && !usagePoller.isActive()) {
      usagePoller.start();
    }

    return { success: true, isAuthenticated: true };
  });

  /**
   * Auth: Logout
   */
  ipcMain.handle("auth:logout", async () => {
    if (isDev) console.log("[IPC] auth:logout requested");
    clearSession();
    clearOrgIdCache();
    await clearSessionCookies();
    usagePoller?.stop();
    return { success: true };
  });

  ipcMain.handle("auth:checkSession", async () => {
    if (isDev) console.log("[IPC] auth:checkSession requested");
    const hasSession = isLoggedIn();
    let isAuthenticated = false;

    if (hasSession) {
      try {
        const cookie = getSession();
        if (cookie) await fetchUsageData(cookie);
        isAuthenticated = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("401") ||
          msg.includes("403") ||
          msg.includes("Authentication failed")
        ) {
          clearSession();
        } else {
          // Parse error only — session is still valid
          isAuthenticated = true;
          console.warn(
            "[IPC] auth:checkSession — usage parse failed (non-auth):",
            msg,
          );
        }
      }
    }

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
  ipcMain.handle("usage:getCurrent", () => {
    if (isDev) console.log("[IPC] usage:getCurrent requested");
    const usageData = usagePoller?.getLastUsageData();
    return { usageData };
  });

  /**
   * Poller: Start polling
   */
  ipcMain.handle("poller:start", () => {
    if (isDev) console.log("[IPC] poller:start requested");
    if (usagePoller && !usagePoller.isActive()) {
      usagePoller.start();
      return { success: true, isActive: true };
    }
    return { success: false, isActive: usagePoller?.isActive() ?? false };
  });

  /**
   * Poller: Stop polling
   */
  ipcMain.handle("poller:stop", () => {
    if (isDev) console.log("[IPC] poller:stop requested");
    usagePoller?.stop();
    return { success: true, isActive: false };
  });

  /**
   * Poller: Set polling interval
   */
  ipcMain.handle("poller:setInterval", (event, seconds: number) => {
    if (isDev) console.log("[IPC] poller:setInterval requested:", seconds);
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
  ipcMain.handle("settings:get", () => {
    if (isDev) console.log("[IPC] settings:get requested");
    return SettingsManager.get();
  });

  /**
   * Settings: Update app settings
   */
  ipcMain.handle("settings:update", (event, settings) => {
    if (isDev) console.log("[IPC] settings:update requested:", settings);
    const updated = SettingsManager.update(settings);
    // Apply pollingInterval change live if poller is running
    if (settings.pollingInterval && usagePoller) {
      usagePoller.setPollingInterval(updated.pollingInterval);
    }
    return { success: true, settings: updated };
  });

  /**
   * Menu: Show native OS context menu (renders outside window bounds)
   */
  ipcMain.handle(
    "menu:showContextMenu",
    (event, opts: { userName: string; planType: string; size: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const sizes = ["Small", "Medium", "Large"] as const;
      const menu = Menu.buildFromTemplate([
        { label: "View Size", enabled: false },
        ...sizes.map((s) => ({
          label: s,
          type: "radio" as const,
          checked: opts.size === s,
          click: () => win?.webContents.send("menu:sizeChange", s),
        })),
        { type: "separator" },
        {
          label: "Logout",
          click: () => win?.webContents.send("menu:logout"),
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
  ipcMain.handle("app:quit", () => {
    if (isDev) console.log("[IPC] app:quit requested");
    app.quit();
  });

  ipcMain.handle("app:minimize", () => {
    mainWindow.minimize();
  });

  /**
   * App: Get version
   */
  ipcMain.handle("app:getVersion", () => {
    if (isDev) console.log("[IPC] app:getVersion requested");
    return { version: app.getVersion() };
  });

  ipcMain.handle("app:openExternal", (_event, url: string) => {
    const allowed = ["https://claude.ai/"];
    if (allowed.some((prefix) => url.startsWith(prefix))) {
      shell.openExternal(url);
    }
  });

  /**
   * Browser preference: reset stored choice
   */
  ipcMain.handle("browser:resetPreference", () => {
    resetBrowserPreference();
    return { success: true };
  });

  /**
   * Browser preference: get current browser name
   */
  ipcMain.handle("browser:getPreference", () => {
    return { browserName: getPreferredBrowserName() };
  });

  /**
   * Listen for poller events and forward to renderer
   */
  if (usagePoller) {
    usagePoller.on("usageUpdate", (usageData) => {
      mainWindow.webContents.send("usage:updated", { usageData });
    });

    usagePoller.on("thresholdCrossed", (event) => {
      mainWindow.webContents.send("notification:threshold", event);
    });

    usagePoller.on("authExpired", () => {
      mainWindow.webContents.send("auth:expired");
    });

    usagePoller.on("pollError", (error) => {
      mainWindow.webContents.send("poller:error", {
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
