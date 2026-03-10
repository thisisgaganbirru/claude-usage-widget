import { dialog, shell, BrowserWindow } from "electron";
import Store from "electron-store";
import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import isDev from "electron-is-dev";

interface BrowserInfo {
  name: string;
  executablePath: string;
}

interface PreferencesStore {
  browserName: string;
  browserPath: string;
}

const store = new Store<PreferencesStore>({ name: "user-preferences" });

// OS-specific candidate paths for each browser
const BROWSER_CANDIDATES: Record<
  string,
  { win32: string[]; darwin: string[]; linux: string[] }
> = {
  "Google Chrome": {
    win32: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      path.join(
        process.env.LOCALAPPDATA || "",
        "Google\\Chrome\\Application\\chrome.exe",
      ),
    ],
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
  },
  "Microsoft Edge": {
    win32: [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
    darwin: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
    linux: ["/usr/bin/microsoft-edge"],
  },
  Firefox: {
    win32: [
      "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
      "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
    ],
    darwin: ["/Applications/Firefox.app/Contents/MacOS/firefox"],
    linux: ["/usr/bin/firefox"],
  },
  Brave: {
    win32: [
      path.join(
        process.env.LOCALAPPDATA || "",
        "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      ),
      "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ],
    darwin: ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
    linux: ["/usr/bin/brave-browser"],
  },
  Arc: {
    win32: [],
    darwin: ["/Applications/Arc.app/Contents/MacOS/Arc"],
    linux: [],
  },
  Opera: {
    win32: [
      path.join(
        process.env.APPDATA || "",
        "Opera Software\\Opera Stable\\launcher.exe",
      ),
      "C:\\Program Files\\Opera\\launcher.exe",
    ],
    darwin: ["/Applications/Opera.app/Contents/MacOS/Opera"],
    linux: ["/usr/bin/opera"],
  },
  Safari: {
    win32: [],
    darwin: ["/Applications/Safari.app/Contents/MacOS/Safari"],
    linux: [],
  },
};

function detectInstalledBrowsers(): BrowserInfo[] {
  const platform = process.platform as "win32" | "darwin" | "linux";
  const installed: BrowserInfo[] = [];

  for (const [name, paths] of Object.entries(BROWSER_CANDIDATES)) {
    const platformPaths = paths[platform] || [];
    for (const execPath of platformPaths) {
      if (execPath && fs.existsSync(execPath)) {
        installed.push({ name, executablePath: execPath });
        break;
      }
    }
  }

  return installed;
}

async function showBrowserPickerDialog(
  installedBrowsers: BrowserInfo[],
  parentWindow?: BrowserWindow,
): Promise<BrowserInfo | "system" | null> {
  const choiceLabels = installedBrowsers.map((b) => b.name);
  choiceLabels.push("System Default");

  const parent = parentWindow || BrowserWindow.getFocusedWindow() || undefined;

  const result = await dialog.showMessageBox(parent as BrowserWindow, {
    type: "question",
    title: "Choose Browser",
    message: "Which browser would you like to use?",
    detail:
      "Your choice will be saved and used every time you open a link. You can change it later in Settings.",
    buttons: [...choiceLabels, "Cancel"],
    defaultId: 0,
    cancelId: choiceLabels.length,
  });

  const idx = result.response;

  if (idx === choiceLabels.length) {
    return null; // User cancelled
  }

  if (idx === choiceLabels.length - 1) {
    return "system"; // "System Default"
  }

  return installedBrowsers[idx];
}

/**
 * Main entry point. Opens a URL in the user's preferred browser.
 * On first call, shows a native picker dialog and stores the choice.
 * On subsequent calls, uses the stored preference directly.
 */
export async function openInPreferredBrowser(
  url: string,
  parentWindow?: BrowserWindow,
): Promise<void> {
  const storedName = store.get("browserName") as string | undefined;
  const storedPath = store.get("browserPath") as string | undefined;

  if (storedName && storedPath) {
    if (isDev) console.log(`[BrowserPreference] Using stored browser: ${storedName}`);
    if (storedName === "System Default") {
      await shell.openExternal(url);
    } else {
      exec(`"${storedPath}" "${url}"`);
    }
    return;
  }

  // First use: detect installed browsers and show picker
  const installed = detectInstalledBrowsers();
  if (isDev) console.log(
    `[BrowserPreference] Detected browsers: ${installed.map((b) => b.name).join(", ") || "none"}`,
  );

  if (installed.length === 0) {
    if (isDev) console.log(
      "[BrowserPreference] No browsers detected, using system default",
    );
    await shell.openExternal(url);
    return;
  }

  const choice = await showBrowserPickerDialog(installed, parentWindow);

  if (choice === null) {
    // Cancelled — fall back silently
    if (isDev) console.log(
      "[BrowserPreference] Dialog cancelled, falling back to shell.openExternal",
    );
    await shell.openExternal(url);
    return;
  }

  if (choice === "system") {
    store.set("browserName", "System Default");
    store.set("browserPath", "system");
    if (isDev) console.log("[BrowserPreference] Saved preference: System Default");
    await shell.openExternal(url);
    return;
  }

  store.set("browserName", choice.name);
  store.set("browserPath", choice.executablePath);
  if (isDev) console.log(`[BrowserPreference] Saved preference: ${choice.name}`);
  exec(`"${choice.executablePath}" "${url}"`);
}

/**
 * Clears the stored browser preference (call from Settings page).
 */
export function resetBrowserPreference(): void {
  store.delete("browserName");
  store.delete("browserPath");
  if (isDev) console.log("[BrowserPreference] Browser preference reset");
}

/**
 * Returns the currently stored browser name, or null if not set.
 */
export function getPreferredBrowserName(): string | null {
  return (store.get("browserName") as string | undefined) ?? null;
}
