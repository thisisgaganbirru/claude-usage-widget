/**
 * Settings migrations.
 *
 * v1 described a single Claude-shaped poller: one interval, one list of
 * session thresholds, one list of weekly thresholds. v2 describes N providers,
 * each with its own interval and one threshold list applied to every window
 * that provider reports.
 *
 * The two v1 threshold lists become the union of both, per provider. That is
 * the only mapping that discards nothing the user configured. The cost is
 * stated plainly: a percentage they had set for the weekly window alone now
 * also alerts on the session window. Dropping one of the two lists instead
 * would silently throw away a setting, which is worse.
 */
import type { WidgetSettings } from "@shared/types";
import { PROVIDER_IDS } from "@shared/usage";
import {
  createDefaultSettings,
  normalizeSettings,
  normalizeThresholds,
} from "./normalize";

/** The shape v1 wrote. Only the fields the migration reads are listed. */
interface SettingsV1 {
  pollingInterval?: unknown;
  notificationThresholds?: unknown;
  weeklyNotificationThresholds?: unknown;
  enableDesktopNotifications?: unknown;
  enableBannerNotifications?: unknown;
  startOnBoot?: unknown;
  keepInTray?: unknown;
  quickEntryShortcut?: unknown;
  theme?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** v1 had no version field; v2 and later always do. */
export function isLegacySettings(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return typeof raw.version !== "number" && "pollingInterval" in raw;
}

export function migrateV1ToV2(raw: unknown): WidgetSettings {
  const defaults = createDefaultSettings();
  if (!isRecord(raw)) return defaults;
  const v1 = raw as SettingsV1;

  const thresholds = normalizeThresholds([
    ...(Array.isArray(v1.notificationThresholds)
      ? v1.notificationThresholds
      : []),
    ...(Array.isArray(v1.weeklyNotificationThresholds)
      ? v1.weeklyNotificationThresholds
      : []),
  ]);

  const providers = { ...defaults.providers };
  for (const id of PROVIDER_IDS) {
    providers[id] = {
      ...providers[id],
      intervalSec:
        typeof v1.pollingInterval === "number"
          ? v1.pollingInterval
          : providers[id].intervalSec,
      thresholds:
        thresholds.length > 0 ? [...thresholds] : providers[id].thresholds,
    };
  }

  // normalizeSettings does the clamping, so a v1 file with an out-of-range
  // interval lands in range rather than carrying the bad value forward.
  return normalizeSettings({
    ...defaults,
    providers,
    enableDesktopNotifications:
      typeof v1.enableDesktopNotifications === "boolean"
        ? v1.enableDesktopNotifications
        : defaults.enableDesktopNotifications,
    enableBannerNotifications:
      typeof v1.enableBannerNotifications === "boolean"
        ? v1.enableBannerNotifications
        : defaults.enableBannerNotifications,
    startOnBoot:
      typeof v1.startOnBoot === "boolean"
        ? v1.startOnBoot
        : defaults.startOnBoot,
    keepInTray:
      typeof v1.keepInTray === "boolean" ? v1.keepInTray : defaults.keepInTray,
    quickEntryShortcut:
      typeof v1.quickEntryShortcut === "string"
        ? v1.quickEntryShortcut
        : defaults.quickEntryShortcut,
    theme:
      v1.theme === "light" || v1.theme === "dark" || v1.theme === "auto"
        ? v1.theme
        : defaults.theme,
  });
}

/** Brings any stored settings object up to the current schema. */
export function migrateSettings(raw: unknown): WidgetSettings {
  if (isLegacySettings(raw)) return migrateV1ToV2(raw);
  return normalizeSettings(raw as Partial<WidgetSettings> | null);
}
