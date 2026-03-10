import { Tray, Menu, BrowserWindow, app, nativeImage } from "electron";
import * as path from "path";
import isDev from "electron-is-dev";
import { UsageData } from "@shared/types";

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
    const iconPath = isDev
      ? path.join(process.cwd(), "assets", "icons", "ClaudeIcon-Square.png")
      : path.join(process.resourcesPath, "assets", "icons", "ClaudeIcon-Square.png");

    try {
      const img = nativeImage
        .createFromPath(iconPath)
        .resize({ width: 16, height: 16 });
      if (img.isEmpty()) throw new Error(`Empty tray image: ${iconPath}`);
      this.tray = new Tray(img);
    } catch (error) {
      console.warn(
        "[TrayManager] Failed to create tray with icon, using fallback",
      );
      try {
        const fallback = nativeImage
          .createFromPath(
            isDev
              ? path.join(process.cwd(), "assets", "icons", "app.png")
              : path.join(process.resourcesPath, "assets", "icons", "app.png"),
          )
          .resize({ width: 16, height: 16 });
        if (fallback.isEmpty()) throw new Error("Empty fallback tray image");
        this.tray = new Tray(fallback);
      } catch {
        console.error("[TrayManager] Could not create tray at all");
        return;
      }
    }

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

    const iconPath = isDev
      ? path.join(process.cwd(), "assets", "icons", iconName)
      : path.join(process.resourcesPath, "assets", "icons", iconName);

    try {
      const img = nativeImage
        .createFromPath(iconPath)
        .resize({ width: 16, height: 16 });
      if (!img.isEmpty()) {
        this.tray.setImage(img);
      } else {
        const fallback = nativeImage
          .createFromPath(
            isDev
              ? path.join(process.cwd(), "assets", "icons", "ClaudeIcon-Square.png")
              : path.join(process.resourcesPath, "assets", "icons", "ClaudeIcon-Square.png"),
          )
          .resize({ width: 16, height: 16 });
        if (!fallback.isEmpty()) this.tray.setImage(fallback);
      }
    } catch (error) {
      console.warn("[TrayManager] Failed to update icon:", error);
    }

    // Update tooltip with current usage
    const tooltip = `Claude Usage\n${usageData.currentUsage}/${usageData.planLimit} (${usageData.percentageUsed.toFixed(1)}%)`;
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
      this.mainWindow.webContents.send("action:refreshNow");
    }
  }

  /**
   * Open settings window
   */
  private openSettings(): void {
    if (this.mainWindow) {
      this.mainWindow.webContents.send("action:openSettings");
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
