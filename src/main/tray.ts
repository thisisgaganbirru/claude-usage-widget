import {
  Tray,
  Menu,
  BrowserWindow,
  app,
  nativeImage,
  NativeImage,
} from "electron";
import * as path from "path";
import isDev from "electron-is-dev";
import { UsageData } from "@shared/types";
import { IPC_ON_CHANNELS } from "@shared/ipc-channels";

const TRAY_ICON_SIZE = { width: 16, height: 16 };

function iconPath(fileName: string): string {
  const base = isDev ? process.cwd() : process.resourcesPath;
  return path.join(base, "assets", "icons", fileName);
}

/** First candidate that loads to a non-empty image, or null. */
function loadTrayIcon(candidates: string[]): NativeImage | null {
  for (const name of candidates) {
    try {
      const img = nativeImage
        .createFromPath(iconPath(name))
        .resize(TRAY_ICON_SIZE);
      if (!img.isEmpty()) return img;
      console.warn(`[TrayManager] Empty tray image: ${name}`);
    } catch (error) {
      console.warn(`[TrayManager] Failed to load tray image ${name}:`, error);
    }
  }
  return null;
}

interface TrayManagerOptions {
  onRefreshNow?: () => void | Promise<void>;
}

export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private onRefreshNow?: () => void | Promise<void>;

  constructor(mainWindow: BrowserWindow, options: TrayManagerOptions = {}) {
    this.mainWindow = mainWindow;
    this.onRefreshNow = options.onRefreshNow;
  }

  /**
   * Initialize system tray icon and menu
   */
  create(): void {
    const img = loadTrayIcon(["ClaudeIcon-Square.png", "app.png"]);
    if (!img) {
      console.error("[TrayManager] Could not load any tray icon");
      return;
    }
    this.tray = new Tray(img);

    // Create context menu
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show Widget",
        click: () => this.showWindow(),
      },
      {
        label: "Refresh Now",
        click: () => this.refreshNow(),
      },
      { type: "separator" },
      {
        label: "Settings",
        click: () => this.openSettings(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          (app as any).isQuitting = true;
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);

    // Handle tray icon click
    this.tray.on("click", () => {
      this.toggleWindow();
    });

    // Set tooltip
    this.tray.setToolTip("Claude Usage Widget");

    if (isDev) console.log("[TrayManager] System tray initialized");
  }

  /**
   * Update tray icon based on usage percentage
   */
  updateIcon(usageData: UsageData): void {
    if (!this.tray) return;

    const percentage = usageData.percentageUsed;
    let iconName = "tray.png"; // 0-50%

    if (percentage >= 90) {
      iconName = "tray-critical.png"; // 90%+ red
    } else if (percentage >= 75) {
      iconName = "tray-warning.png"; // 75-90% orange
    } else if (percentage >= 50) {
      iconName = "tray-medium.png"; // 50-75% amber
    }

    const img = loadTrayIcon([iconName, "ClaudeIcon-Square.png"]);
    if (img) this.tray.setImage(img);

    // Update tooltip with current usage
    const providerLabel = usageData.provider === "chatgpt" ? "ChatGPT" : "Claude";
    const tooltip = `${providerLabel} Usage\n${usageData.currentUsage}/${usageData.planLimit} (${usageData.percentageUsed.toFixed(1)}%)`;
    this.tray.setToolTip(tooltip);
  }

  /**
   * Show widget window
   */
  showWindow(): void {
    if (this.mainWindow) {
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  /**
   * Toggle widget window visibility
   */
  toggleWindow(): void {
    if (!this.mainWindow) return;

    if (this.mainWindow.isVisible()) {
      this.mainWindow.hide();
    } else {
      this.showWindow();
    }
  }

  /**
   * Refresh usage data immediately
   */
  private refreshNow(): void {
    if (this.onRefreshNow) {
      void this.onRefreshNow();
      return;
    }

    if (this.mainWindow) {
      this.mainWindow.webContents.send(IPC_ON_CHANNELS.ACTION_REFRESH_NOW);
    }
  }

  /**
   * Open settings window
   */
  private openSettings(): void {
    if (this.mainWindow) {
      this.mainWindow.webContents.send(IPC_ON_CHANNELS.ACTION_OPEN_SETTINGS);
    }
  }

  /**
   * Destroy tray on app quit
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
