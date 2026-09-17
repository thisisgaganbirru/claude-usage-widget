import Store from "electron-store";
import { createLogger } from "@main/logging/logger";
import {
  SETTINGS_VERSION,
  type SettingsPatch,
  type WidgetSettings,
} from "@shared/types";
import { isProviderId } from "@shared/usage";
import { migrateSettings } from "./migrate";
import { createDefaultSettings, normalizeSettings } from "./normalize";

const log = createLogger("settings");

const store = new Store<{ settings: unknown }>({
  name: "settings-store",
  defaults: {
    settings: createDefaultSettings(),
  },
});

/**
 * Migrate on first read and write the result back, so the upgrade happens once
 * rather than on every read. A failed write is not fatal: the migration is
 * pure, so the next read produces the same answer.
 */
function readAndUpgrade(): WidgetSettings {
  const raw = store.get("settings");
  const migrated = migrateSettings(raw);

  const storedVersion =
    typeof raw === "object" && raw !== null
      ? (raw as { version?: unknown }).version
      : undefined;
  if (storedVersion !== SETTINGS_VERSION) {
    try {
      store.set("settings", migrated);
      log.info("settings migrated", {
        from: typeof storedVersion === "number" ? storedVersion : 1,
        to: SETTINGS_VERSION,
      });
    } catch (error) {
      log.warn("could not persist migrated settings", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return migrated;
}

export class SettingsManager {
  static get(): WidgetSettings {
    try {
      return readAndUpgrade();
    } catch (error) {
      log.error("failed to read settings", {
        error: error instanceof Error ? error.message : String(error),
      });
      return createDefaultSettings();
    }
  }

  /**
   * Merge a patch over the stored settings. Provider blocks merge field by
   * field, so a renderer that sends `{ providers: { claude: { enabled: false } } }`
   * changes exactly that and leaves the interval and thresholds alone.
   */
  static update(partial: SettingsPatch): WidgetSettings {
    try {
      const current = this.get();
      const providers = { ...current.providers };
      for (const [id, block] of Object.entries(partial.providers ?? {})) {
        if (!isProviderId(id) || block === undefined) continue;
        providers[id] = { ...providers[id], ...block };
      }

      const updated = normalizeSettings({ ...current, ...partial, providers });

      store.set("settings", updated);
      return updated;
    } catch (error) {
      log.error("failed to update settings", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.get();
    }
  }

  static reset(): WidgetSettings {
    const defaults = createDefaultSettings();
    store.set("settings", defaults);
    return defaults;
  }
}
