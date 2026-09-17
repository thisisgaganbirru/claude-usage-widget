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
  worstAcrossProviders,
  worstWindow,
  type ProviderId,
  type ProviderState,
  type ProviderStateEntry,
} from "@shared/usage";

const TRAY_ICON_SIZE = { width: 16, height: 16 };

/** Shown before any provider has reported. The rename is a separate change. */
const APP_TITLE = "Claude Usage Widget";

/**
 * Used-percent thresholds the icon changes colour at, highest first.
 *
 * These are fixed rather than read from the notification thresholds on
 * purpose. Those are per provider and user-editable; the tray has one icon for
 * everything, so it needs one scale that does not change meaning when somebody
 * edits a setting for one vendor.
 */
const ICON_STEPS: ReadonlyArray<{ atLeast: number; icon: string }> = [
  { atLeast: 90, icon: "tray-critical.png" },
  { atLeast: 75, icon: "tray-warning.png" },
  { atLeast: 50, icon: "tray-medium.png" },
  { atLeast: 0, icon: "tray.png" },
];

/** Electron has no typed slot for this, and the quit handler needs it. */
interface QuittableApp {
  isQuitting?: boolean;
}

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

/** A short, fixed phrase per state. Never a vendor's error text. */
function describeState(state: ProviderState): string {
  switch (state.kind) {
    case "not-detected":
      return "not detected";
    case "needs-auth":
      return "sign in needed";
    case "error":
      return state.code === "rate-limited" ? "rate limited" : "unavailable";
    case "ok": {
      const worst = worstWindow(state.usage.windows);
      const detail =
        worst === null
          ? "no usage reported"
          : `${worst.label} ${worst.usedPercent.toFixed(0)}%`;
      return state.staleSince === undefined ? detail : `${detail} (stale)`;
    }
    default:
      return "unknown";
  }
}

function iconFor(usedPercent: number): string {
  for (const step of ICON_STEPS) {
    if (usedPercent >= step.atLeast) return step.icon;
  }
  return ICON_STEPS[ICON_STEPS.length - 1].icon;
}

interface TrayManagerOptions {
  onRefreshNow?: () => void | Promise<void>;
}

export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private onRefreshNow?: () => void | Promise<void>;
  /** The latest state per provider, so the icon reflects all of them. */
  private readonly states = new Map<ProviderId, ProviderState>();

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
          (app as QuittableApp).isQuitting = true;
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);

    // Handle tray icon click
    this.tray.on("click", () => {
      this.toggleWindow();
    });

    this.tray.setToolTip(APP_TITLE);

    if (isDev) console.log("[TrayManager] System tray initialized");
  }

  /**
   * Record one provider's state and repaint the tray from everything known.
   *
   * Each provider polls on its own timer, so this is called once per provider
   * per cycle. Keeping the whole picture and recomputing is what stops the
   * icon meaning "whichever provider answered last", which is a number the
   * user cannot act on because it changes subject every few seconds.
   */
  updateFromState(providerId: ProviderId, state: ProviderState): void {
    this.states.set(providerId, state);
    this.repaint();
  }

  /** Drops a provider's state, e.g. when it is switched off in settings. */
  forgetProvider(providerId: ProviderId): void {
    if (this.states.delete(providerId)) this.repaint();
  }

  private entries(): ProviderStateEntry[] {
    return [...this.states].map(([providerId, state]) => ({
      providerId,
      state,
    }));
  }

  private repaint(): void {
    if (!this.tray) return;

    const entries = this.entries();
    const worst = worstAcrossProviders(entries);

    const img = loadTrayIcon([
      worst === null ? "tray.png" : iconFor(worst.window.usedPercent),
      "ClaudeIcon-Square.png",
    ]);
    if (img) this.tray.setImage(img);

    this.tray.setToolTip(this.tooltip(entries, worst));
  }

  /**
   * A headline naming who is closest to a wall, then one line per provider.
   *
   * The per-provider lines are what make the headline trustworthy: without
   * them a user seeing a green icon cannot tell whether everything is fine or
   * whether the one provider they care about has quietly stopped reporting.
   */
  private tooltip(
    entries: ProviderStateEntry[],
    worst: ReturnType<typeof worstAcrossProviders>,
  ): string {
    if (entries.length === 0) return APP_TITLE;

    const lines = entries.map(
      (entry) =>
        `${providerLabel(entry.providerId)}: ${describeState(entry.state)}`,
    );

    if (worst === null) return [APP_TITLE, ...lines].join("\n");

    const headline = `${providerLabel(worst.providerId)} ${worst.window.label} ${worst.window.usedPercent.toFixed(0)}%`;
    return entries.length === 1 ? headline : [headline, ...lines].join("\n");
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
