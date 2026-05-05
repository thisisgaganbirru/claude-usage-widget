import Store from "electron-store";
import { WidgetSettings } from "@shared/types";
import isDev from "electron-is-dev";

const DEFAULT_SETTINGS: WidgetSettings = {
  pollingInterval: 60,
  notificationThresholds: [50, 75, 90, 95],
  weeklyNotificationThresholds: [50, 75, 90, 100],
  enableDesktopNotifications: true,
  enableBannerNotifications: true,
  startOnBoot: false,
  keepInTray: true,
  quickEntryShortcut: "Control+Alt+Space",
  theme: "auto",
};

function normalizeThresholds(values: number[] | undefined): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values.filter((value) => Number.isFinite(value) && value > 0 && value <= 100),
    ),
  ).sort((a, b) => a - b);
}

function normalizeSettings(settings: Partial<WidgetSettings>): WidgetSettings {
  const merged: WidgetSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
  };

  if (merged.pollingInterval < 30) merged.pollingInterval = 30;
  if (merged.pollingInterval > 300) merged.pollingInterval = 300;

  const normalizedSessionThresholds = normalizeThresholds(
    merged.notificationThresholds,
  );
  merged.notificationThresholds =
    normalizedSessionThresholds.length > 0
      ? normalizedSessionThresholds
      : DEFAULT_SETTINGS.notificationThresholds;

  const normalizedWeeklyThresholds = normalizeThresholds(
    merged.weeklyNotificationThresholds,
  );
  merged.weeklyNotificationThresholds =
    normalizedWeeklyThresholds.length > 0
      ? normalizedWeeklyThresholds
      : DEFAULT_SETTINGS.weeklyNotificationThresholds;

  merged.startOnBoot = Boolean(merged.startOnBoot);
  merged.keepInTray = Boolean(merged.keepInTray);
  const shortcut =
    typeof merged.quickEntryShortcut === "string"
      ? merged.quickEntryShortcut.trim()
      : "";
  merged.quickEntryShortcut =
    shortcut.length > 0 ? shortcut : DEFAULT_SETTINGS.quickEntryShortcut;

  return merged;
}

const store = new Store<{ settings: WidgetSettings }>({
  name: "settings-store",
  defaults: {
    settings: DEFAULT_SETTINGS,
  },
});

export class SettingsManager {
  static get(): WidgetSettings {
    try {
      const raw = store.get("settings", DEFAULT_SETTINGS);
      return normalizeSettings(raw);
    } catch (error) {
      console.error("[SettingsManager] Failed to get settings:", error);
      return DEFAULT_SETTINGS;
    }
  }

  static update(partial: Partial<WidgetSettings>): WidgetSettings {
    try {
      const current = this.get();
      const updated = normalizeSettings({ ...current, ...partial });

      store.set("settings", updated);
      if (isDev) console.log("[SettingsManager] Settings updated:", updated);
      return updated;
    } catch (error) {
      console.error("[SettingsManager] Failed to update settings:", error);
      return this.get();
    }
  }

  static reset(): WidgetSettings {
    store.set("settings", DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
}
