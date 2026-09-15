import { WidgetSettings } from "@shared/types";

export const POLLING_INTERVAL_MIN_SEC = 30;
export const POLLING_INTERVAL_MAX_SEC = 300;

export const DEFAULT_SETTINGS: WidgetSettings = {
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

/** Keep finite percentages in (0, 100], dedupe, sort ascending. */
export function normalizeThresholds(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values.filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value > 0 &&
          value <= 100,
      ),
    ),
  ).sort((a, b) => a - b);
}

/**
 * Merge a partial (possibly untrusted) settings object over the defaults and
 * coerce every field into its valid range. Pure: no Electron, no I/O.
 */
export function normalizeSettings(
  settings: Partial<WidgetSettings> | null | undefined,
): WidgetSettings {
  const merged: WidgetSettings = {
    ...DEFAULT_SETTINGS,
    ...(settings ?? {}),
  };

  if (
    typeof merged.pollingInterval !== "number" ||
    !Number.isFinite(merged.pollingInterval)
  ) {
    merged.pollingInterval = DEFAULT_SETTINGS.pollingInterval;
  }
  if (merged.pollingInterval < POLLING_INTERVAL_MIN_SEC)
    merged.pollingInterval = POLLING_INTERVAL_MIN_SEC;
  if (merged.pollingInterval > POLLING_INTERVAL_MAX_SEC)
    merged.pollingInterval = POLLING_INTERVAL_MAX_SEC;

  const sessionThresholds = normalizeThresholds(merged.notificationThresholds);
  merged.notificationThresholds =
    sessionThresholds.length > 0
      ? sessionThresholds
      : DEFAULT_SETTINGS.notificationThresholds;

  const weeklyThresholds = normalizeThresholds(
    merged.weeklyNotificationThresholds,
  );
  merged.weeklyNotificationThresholds =
    weeklyThresholds.length > 0
      ? weeklyThresholds
      : DEFAULT_SETTINGS.weeklyNotificationThresholds;

  merged.enableDesktopNotifications = Boolean(
    merged.enableDesktopNotifications,
  );
  merged.enableBannerNotifications = Boolean(merged.enableBannerNotifications);
  merged.startOnBoot = Boolean(merged.startOnBoot);
  merged.keepInTray = Boolean(merged.keepInTray);

  const shortcut =
    typeof merged.quickEntryShortcut === "string"
      ? merged.quickEntryShortcut.trim()
      : "";
  merged.quickEntryShortcut =
    shortcut.length > 0 ? shortcut : DEFAULT_SETTINGS.quickEntryShortcut;

  if (!["light", "dark", "auto"].includes(merged.theme)) {
    merged.theme = DEFAULT_SETTINGS.theme;
  }

  return merged;
}
