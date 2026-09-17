import Store from "electron-store";
import isDev from "electron-is-dev";
import { WidgetSettings } from "@shared/types";
import { DEFAULT_SETTINGS, normalizeSettings } from "./normalize";

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
