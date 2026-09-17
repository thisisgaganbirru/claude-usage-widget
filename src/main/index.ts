// Suppress EPIPE errors (broken pipe when the terminal closes its stdout end)
process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") return;
  console.error("[Main] Uncaught exception:", err);
});

// Handle Squirrel events on Windows (must be first)
if (require("electron-squirrel-startup")) {
  require("electron").app.quit();
}

import { app, BrowserWindow, Menu } from "electron";
import * as path from "path";
import isDev from "electron-is-dev";

import {
  attachConsoleBridge,
  configureLogging,
  createConsoleSink,
  createFileSink,
  createLogger,
} from "./logging/logger";
import { registerIPCHandlers, type WindowControls } from "./ipc/handlers";
import { rendererOrigins } from "./ipc/typed-ipc";
import { getProvider } from "./providers/registry";
import { Scheduler } from "./scheduler";
import { createElectronSchedulerHost } from "./scheduler-host";
import { createThresholdStore } from "./threshold-store";
import {
  SECURE_WEB_PREFERENCES,
  enableProcessSandbox,
  hardenDefaultSession,
  installSecurityPolicy,
  setNavigationPolicy,
} from "./security/policy";
import { originOf } from "./security/url-policy";
import { SettingsManager } from "./settings/settings-manager";
import { TrayManager } from "./tray";
import type { ProviderStateEntry } from "@shared/ipc-contract";

const log = createLogger("main");

// ── Security: everything that has to happen before the app is ready ──────────
// The renderer process runs sandboxed, no WebContents may navigate off its own
// origin, and every permission request is denied by default.
enableProcessSandbox();
installSecurityPolicy();

// No menu bar: this is a tray widget, and a default menu would expose reload,
// devtools and zoom shortcuts we do not want in a packaged build.
Menu.setApplicationMenu(null);

// Flag used by the "close" handler to distinguish tray-hide from a real quit
let isQuitting = false;

let mainWindow: BrowserWindow | null = null;
let scheduler: Scheduler | null = null;
let trayManager: TrayManager | null = null;
let isPinned = true;

// Only one copy of the widget may run: a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function setupLogging(): void {
  configureLogging({
    level: isDev ? "debug" : "info",
    sinks: [
      createConsoleSink(),
      createFileSink({
        filePath: path.join(app.getPath("userData"), "logs", "main.log"),
      }),
    ],
  });
  // Call sites that still use console.* go through redaction too.
  attachConsoleBridge(createLogger("console"));
}

function applyPinnedState(window: BrowserWindow): void {
  window.setAlwaysOnTop(isPinned, isPinned ? "screen-saver" : "normal");
  window.setVisibleOnAllWorkspaces(isPinned, { visibleOnFullScreen: true });
  if (isPinned) window.moveTop();
}

/**
 * The only window operations the IPC layer can reach. Bounds checking already
 * happened in the handler; this decides what the window actually does.
 */
function createWindowControls(): WindowControls {
  return {
    resize(width, height) {
      if (!mainWindow || mainWindow.isDestroyed()) return { success: false };
      mainWindow.setSize(width, height);
      // Center when switching to the login view, which is much larger.
      if (width === 800 && height === 600) mainWindow.center();
      log.debug("window resized", { width, height });
      return { success: true, size: { width, height } };
    },
    getPinned() {
      return isPinned;
    },
    setPinned(pinned) {
      isPinned = pinned;
      if (mainWindow && !mainWindow.isDestroyed()) applyPinnedState(mainWindow);
      return isPinned;
    },
    setIgnoreMouseEvents(ignore) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
      }
    },
  };
}

/** The URL the renderer is served from, normalized to something loadable. */
function rendererEntryUrl(): string {
  if (
    MAIN_WINDOW_WEBPACK_ENTRY.startsWith("http") ||
    MAIN_WINDOW_WEBPACK_ENTRY.startsWith("file://")
  ) {
    return MAIN_WINDOW_WEBPACK_ENTRY;
  }
  return `file://${MAIN_WINDOW_WEBPACK_ENTRY}`;
}

const createWindow = (): BrowserWindow => {
  const startUrl = rendererEntryUrl();

  const newWindow = new BrowserWindow({
    width: 350,
    height: 80,
    show: true,
    center: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: isPinned,
    maximizable: false,
    fullscreenable: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  // The widget only ever displays its own bundle. Anything else, including a
  // link the renderer tries to open itself, is blocked by the policy module.
  const ownOrigin = originOf(startUrl);
  setNavigationPolicy(newWindow.webContents, {
    navigate: ownOrigin ? [ownOrigin] : [],
    external: ["https://claude.ai", "https://chatgpt.com"],
  });

  applyPinnedState(newWindow);
  // Transparent areas pass mouse events through by default
  newWindow.setIgnoreMouseEvents(true, { forward: true });

  log.info("loading renderer", { url: startUrl });
  void newWindow.loadURL(startUrl);

  newWindow.webContents.on("did-finish-load", () => {
    if (!newWindow.isDestroyed()) {
      newWindow.show();
      newWindow.focus();
    }
  });

  // Fallback: show the window after 3 seconds even if the page never loads,
  // so a broken bundle does not leave the user with nothing on screen.
  setTimeout(() => {
    if (!newWindow.isDestroyed()) {
      newWindow.show();
      newWindow.focus();
    }
  }, 3000);

  newWindow.webContents.on("render-process-gone", (_event, details) => {
    log.error("renderer process gone", {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  newWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      log.error("renderer failed to load", { errorCode, errorDescription });
    },
  );

  newWindow.on("closed", () => {
    if (mainWindow === newWindow) mainWindow = null;
  });

  // Hide to tray on close instead of quitting
  newWindow.on("close", (event) => {
    const keepInTray = SettingsManager.get().keepInTray;
    if (!isQuitting && keepInTray) {
      event.preventDefault();
      newWindow.hide();
    }
  });

  // Prevent Windows Aero Snap from moving or maximizing the widget
  newWindow.on("maximize", () => newWindow.unmaximize());

  if (isDev) newWindow.webContents.openDevTools({ mode: "detach" });

  return newWindow;
};

function wireWindow(window: BrowserWindow, activeScheduler: Scheduler): void {
  registerIPCHandlers(
    window,
    activeScheduler,
    createWindowControls(),
    rendererOrigins(rendererEntryUrl()),
  );
}

const app_ready = (): void => {
  try {
    setupLogging();
    hardenDefaultSession();

    mainWindow = createWindow();

    // Register for auto-launch on login (packaged builds only)
    if (!isDev) {
      const startOnBoot = SettingsManager.get().startOnBoot;
      app.setLoginItemSettings({
        openAtLogin: startOnBoot,
        name: "Claude Usage Widget",
      });
      log.info("auto-start configured", { startOnBoot });
    }

    scheduler = new Scheduler({
      host: createElectronSchedulerHost(),
      getSettings: () => SettingsManager.get(),
      getProvider,
      thresholds: createThresholdStore(),
    });
    wireWindow(mainWindow, scheduler);

    trayManager = new TrayManager(mainWindow, {
      onRefreshNow: () => scheduler?.refresh(),
    });
    trayManager.create();

    scheduler.on("state", (entry: ProviderStateEntry) => {
      trayManager?.updateFromState(entry.providerId, entry.state);
    });

    scheduler.start();
  } catch (err) {
    log.error("fatal error during startup", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

app.on("ready", app_ready);

app.on("before-quit", () => {
  isQuitting = true;
  scheduler?.stop();
});

app.on("window-all-closed", () => {
  trayManager?.destroy();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    mainWindow = createWindow();
    if (scheduler) wireWindow(mainWindow, scheduler);
  } else {
    mainWindow.show();
  }
});

// Declare the Webpack entry points injected by Electron Forge
declare global {
  const MAIN_WINDOW_WEBPACK_ENTRY: string;
  const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
}
