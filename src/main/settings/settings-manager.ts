import Store from "electron-store";
import { WidgetSettings } from "@shared/types";
import isDev from "electron-is-dev";

const DEFAULT_SETTINGS: WidgetSettings = {
  pollingInterval: 60,
  notificationThresholds: [50, 75, 90, 95],
  enableNotifications: true,
  startOnBoot: false,
  theme: "auto",
};

const store = new Store<{ settings: WidgetSettings }>({
  name: "settings-store",
  defaults: {
    settings: DEFAULT_SETTINGS,
  },
});

export class SettingsManager {
  static get(): WidgetSettings {
    try {
      return store.get("settings", DEFAULT_SETTINGS);
    } catch (error) {
      console.error("[SettingsManager] Failed to get settings:", error);
      return DEFAULT_SETTINGS;
    }
  }

  static update(partial: Partial<WidgetSettings>): WidgetSettings {
    try {
      const current = this.get();
      const updated: WidgetSettings = { ...current, ...partial };

      // Validate pollingInterval bounds
      if (updated.pollingInterval < 30) updated.pollingInterval = 30;
      if (updated.pollingInterval > 300) updated.pollingInterval = 300;

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
