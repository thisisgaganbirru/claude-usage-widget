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
import { IPC_ON_CHANNELS } from "@shared/ipc-channels";
import { providerLabel } from "@shared/provider-labels";
import {
  worstWindow,
  type ProviderId,
  type ProviderState,
} from "@shared/usage";

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

/** A short, fixed phrase per state kind. Never a vendor's error text. */
function describeState(state: ProviderState): string {
  switch (state.kind) {
    case "not-detected":
      return "not detected";
    case "needs-auth":
      return "sign in needed";
    case "error":
      return state.code === "rate-limited" ? "rate limited" : "unavailable";
    default:
      return "unknown";
  }
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
   * Colour the tray by the worst window one provider is reporting.
   *
   * With several providers polling on their own timers this is last-writer-
   * wins, which is wrong once more than one is enabled. P5 gives the tray the
   * whole snapshot and a real "worst across providers" rule; until then the
   * icon at least tracks a real number instead of a fabricated one.
   */
  updateFromState(providerId: ProviderId, state: ProviderState): void {
    if (!this.tray) return;

    const label = providerLabel(providerId);
    if (state.kind !== "ok") {
      this.tray.setToolTip(`${label}: ${describeState(state)}`);
      return;
    }

    const worst = worstWindow(state.usage.windows);
    const percentage = worst?.usedPercent ?? 0;

    let iconName = "tray.png"; // 0-50%
    if (percentage >= 90) {
      iconName = "tray-critical.png";
    } else if (percentage >= 75) {
      iconName = "tray-warning.png";
    } else if (percentage >= 50) {
      iconName = "tray-medium.png";
    }

    const img = loadTrayIcon([iconName, "ClaudeIcon-Square.png"]);
    if (img) this.tray.setImage(img);

    const detail =
      worst === null
        ? "no usage reported"
        : `${worst.label} ${percentage.toFixed(0)}%`;
    const suffix = state.staleSince ? " (stale)" : "";
    this.tray.setToolTip(`${label}: ${detail}${suffix}`);
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
