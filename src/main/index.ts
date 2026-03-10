// Suppress EPIPE errors (broken pipe when terminal closes its stdout connection)
process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") return;
  console.error("[Main] Uncaught exception:", err);
});

// Handle Squirrel events on Windows (must be first)
if (require("electron-squirrel-startup")) {
  require("electron").app.quit();
}

import { app, BrowserWindow, Menu, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import { SessionManager } from "./auth/session-manager";
import { UsagePoller } from "./data/usage-poller";
import { registerIPCHandlers } from "./ipc/handlers";
import { TrayManager } from "./tray";
import isDev from "electron-is-dev";

// ── File logger (writes to %APPDATA%/claude-usage-widget/logs/main.log) ──────
function setupFileLog() {
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, "main.log");
    const stream = fs.createWriteStream(logFile, { flags: "a" });
    const tag = (level: string) => `[${new Date().toISOString()}] [${level}] `;
    const orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...a) => {
      orig.log(...a);
      stream.write(tag("INFO") + a.join(" ") + "\n");
    };
    console.warn = (...a) => {
      orig.warn(...a);
      stream.write(tag("WARN") + a.join(" ") + "\n");
    };
    console.error = (...a) => {
      orig.error(...a);
      stream.write(tag("ERROR") + a.join(" ") + "\n");
    };
    console.log(`[Main] Log file: ${logFile}`);
  } catch {}
}
setupFileLog();

// Disable menu bar
Menu.setApplicationMenu(null);

// Flag used by the "close" handler to distinguish tray-hide vs real quit
(app as any).isQuitting = false;

let mainWindow: BrowserWindow | null = null;
let usagePoller: UsagePoller | null = null;
let trayManager: TrayManager | null = null;
let isPinned = true;

function applyPinnedState(window: BrowserWindow): void {
  window.setAlwaysOnTop(isPinned, isPinned ? "screen-saver" : "normal");
  window.setVisibleOnAllWorkspaces(isPinned, { visibleOnFullScreen: true });
  if (isPinned) window.moveTop();
}

// IPC handler to resize window
ipcMain.handle("resize-window", (_event, width: number, height: number) => {
  if (isDev) console.log(`[IPC] Received resize request: ${width}x${height}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSize(width, height);
    if (isDev) console.log(`[Main] ✅ Window resized to ${width}x${height}`);
    return { success: true, size: { width, height } };
  }
  return { success: false };
});

ipcMain.handle("get-window-position", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition();
    return { x, y };
  }
  return { x: 0, y: 0 };
});

// IPC handler to move window (custom drag — avoids Aero Snap)
ipcMain.handle("move-window", (_event, x: number, y: number) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setPosition(Math.round(x), Math.round(y));
  }
});

ipcMain.handle("window:getPinned", () => ({ pinned: isPinned }));

ipcMain.handle("window:setPinned", (_event, pinned: boolean) => {
  isPinned = Boolean(pinned);
  if (mainWindow && !mainWindow.isDestroyed()) {
    applyPinnedState(mainWindow);
  }
  return { success: true, pinned: isPinned };
});

ipcMain.on("set-ignore-mouse-events", (_event, ignore: boolean) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

const createWindow = () => {
  console.log("[Main] Creating window...");

  const preloadPath = path.join(__dirname, "preload.js");
  console.log(`[Main] Preload path: ${preloadPath}`);

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
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });
  applyPinnedState(newWindow);
  // Transparent areas pass mouse events through by default
  newWindow.setIgnoreMouseEvents(true, { forward: true });

  if (isDev) console.log("[Main] Window created, loading URL...");

  // Load the app - use bundled production files
  let startUrl: string;
  if (
    MAIN_WINDOW_WEBPACK_ENTRY.startsWith("http") ||
    MAIN_WINDOW_WEBPACK_ENTRY.startsWith("file://")
  ) {
    startUrl = MAIN_WINDOW_WEBPACK_ENTRY;
  } else {
    startUrl = `file://${MAIN_WINDOW_WEBPACK_ENTRY}`;
  }

  console.log("[Main] Loading URL:", startUrl);
  newWindow.loadURL(startUrl);

  newWindow.webContents.on("did-finish-load", () => {
    console.log("[Main] ✅ Page loaded successfully");
    if (!newWindow.isDestroyed()) {
      newWindow.show();
      newWindow.focus();
      console.log("[Main] ✅ Window shown and focused");
    }
  });

  // Fallback: show window after 3 seconds even if page hasn't loaded
  setTimeout(() => {
    if (!newWindow.isDestroyed()) {
      if (isDev)
        console.log("[Main] [Fallback] Force showing window after timeout");
      newWindow.show();
      newWindow.focus();
    }
  }, 3000);

  // Handle loading errors
  newWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      "[Main] Renderer process gone:",
      details.reason,
      JSON.stringify(details),
    );
  });

  newWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[Main] Failed to load page: ${errorCode} ${errorDescription} | URL: ${validatedURL}`,
      );
    },
  );

  newWindow.on("closed", () => {
    if (mainWindow === newWindow) {
      mainWindow = null;
    }
  });

  // Hide to tray on close instead of quitting
  newWindow.on("close", (event) => {
    if (!(app as any).isQuitting) {
      event.preventDefault();
      newWindow.hide();
    }
  });

  // Prevent Windows Aero Snap from moving/maximizing the widget
  newWindow.on("maximize", () => newWindow.unmaximize());

  // Open dev tools in development for debugging
  // newWindow.webContents.openDevTools({ mode: "detach" });

  return newWindow;
};

const app_ready = () => {
  try {
    if (isDev) console.log("[Main] App ready event fired");

    // Register protocol handler for deep links (e.g., claudewidget://auth/callback?session=...)
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient("claudewidget", process.execPath, [
          path.resolve(process.argv[1]),
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient("claudewidget");
    }

    mainWindow = createWindow();

    // Register for auto-launch on Windows login (only in packaged production build)
    if (!isDev) {
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: true,
        name: "Claude Usage Widget",
      });
      console.log("[Main] Auto-start on login: registered");
    }

    usagePoller = new UsagePoller();
    registerIPCHandlers(mainWindow, usagePoller);

    trayManager = new TrayManager(mainWindow, {
      onRefreshNow: () => usagePoller?.refreshNow(),
    });
    trayManager.create();

    usagePoller.on("usageUpdate", (usageData) => {
      trayManager?.updateIcon(usageData);
    });

    if (SessionManager.isAuthenticated()) {
      usagePoller.start();
    }
  } catch (err) {
    console.error("[Main] FATAL error in app_ready:", err);
  }
};

// App event listeners
app.on("ready", app_ready);

app.on("before-quit", () => {
  (app as any).isQuitting = true;
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
    if (usagePoller) {
      registerIPCHandlers(mainWindow, usagePoller);
    }
  } else {
    mainWindow.show();
  }
});

// Declare Webpack entry point
declare global {
  const MAIN_WINDOW_WEBPACK_ENTRY: string;
}
