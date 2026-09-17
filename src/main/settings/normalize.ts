import {
  SETTINGS_VERSION,
  type ProviderSettings,
  type WidgetSettings,
} from "@shared/types";
import { PROVIDER_IDS, type ProviderId } from "@shared/usage";

export const POLLING_INTERVAL_MIN_SEC = 30;
export const POLLING_INTERVAL_MAX_SEC = 300;

export const DEFAULT_INTERVAL_SEC = 60;
export const DEFAULT_THRESHOLDS = [50, 75, 90, 95];

/**
 * Only the providers that can actually read something today are on by
 * default, so a user who upgrades does not get a row of cards saying "not
 * detected".
 *
 * Every provider that finds its credential on disk is safe to enable: with
 * the vendor's tooling absent, `discoverCredentials` returns null and the card
 * reads "not detected" without a single request going out.
 *
 * Gemini is the exception, and is off. Google's access tokens last about an
 * hour and this app does not refresh them, so an enabled Gemini card would
 * spend most of its life saying the token has expired. Someone who wants it
 * can turn it on; nobody should have to turn off a card that is usually
 * wrong. Enabling it by default becomes right the day a refresh lands.
 */
const ENABLED_BY_DEFAULT: ReadonlySet<ProviderId> = new Set<ProviderId>([
  "claude",
  "chatgpt",
  "codex",
  "copilot",
  "cursor",
]);

export function defaultProviderSettings(id: ProviderId): ProviderSettings {
  return {
    enabled: ENABLED_BY_DEFAULT.has(id),
    intervalSec: DEFAULT_INTERVAL_SEC,
    thresholds: [...DEFAULT_THRESHOLDS],
  };
}

function defaultProviders(): Record<ProviderId, ProviderSettings> {
  const providers = {} as Record<ProviderId, ProviderSettings>;
  for (const id of PROVIDER_IDS) providers[id] = defaultProviderSettings(id);
  return providers;
}

export function createDefaultSettings(): WidgetSettings {
  return {
    version: SETTINGS_VERSION,
    providers: defaultProviders(),
    enableDesktopNotifications: true,
    enableBannerNotifications: true,
    startOnBoot: false,
    keepInTray: true,
    quickEntryShortcut: "Control+Alt+Space",
    theme: "auto",
  };
}

export const DEFAULT_SETTINGS: WidgetSettings = createDefaultSettings();

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

export function clampInterval(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_INTERVAL_SEC;
  }
  if (value < POLLING_INTERVAL_MIN_SEC) return POLLING_INTERVAL_MIN_SEC;
  if (value > POLLING_INTERVAL_MAX_SEC) return POLLING_INTERVAL_MAX_SEC;
  return value;
}

function normalizeProvider(id: ProviderId, raw: unknown): ProviderSettings {
  const defaults = defaultProviderSettings(id);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return defaults;
  }
  const record = raw as Partial<ProviderSettings>;
  const thresholds = normalizeThresholds(record.thresholds);

  return {
    enabled:
      typeof record.enabled === "boolean" ? record.enabled : defaults.enabled,
    intervalSec: clampInterval(record.intervalSec),
    thresholds: thresholds.length > 0 ? thresholds : defaults.thresholds,
  };
}

/**
 * Merge a partial (possibly untrusted) settings object over the defaults and
 * coerce every field into its valid range. Pure: no Electron, no I/O.
 *
 * This is the transform the stored schema is read through, so a hand-edited
 * config file, a downgrade, or a field the next version adds all resolve to
 * something the app can run on rather than throwing at startup.
 */
export function normalizeSettings(
  settings: Partial<WidgetSettings> | null | undefined,
): WidgetSettings {
  const defaults = createDefaultSettings();
  const input = settings ?? {};

  const providers = {} as Record<ProviderId, ProviderSettings>;
  const rawProviders =
    typeof input.providers === "object" && input.providers !== null
      ? (input.providers as Record<string, unknown>)
      : {};
  for (const id of PROVIDER_IDS) {
    providers[id] = normalizeProvider(id, rawProviders[id]);
  }

  const shortcut =
    typeof input.quickEntryShortcut === "string"
      ? input.quickEntryShortcut.trim()
      : "";

  const theme = input.theme;

  return {
    version: SETTINGS_VERSION,
    providers,
    enableDesktopNotifications:
      typeof input.enableDesktopNotifications === "boolean"
        ? input.enableDesktopNotifications
        : defaults.enableDesktopNotifications,
    enableBannerNotifications:
      typeof input.enableBannerNotifications === "boolean"
        ? input.enableBannerNotifications
        : defaults.enableBannerNotifications,
    startOnBoot:
      typeof input.startOnBoot === "boolean"
        ? input.startOnBoot
        : defaults.startOnBoot,
    keepInTray:
      typeof input.keepInTray === "boolean"
        ? input.keepInTray
        : defaults.keepInTray,
    quickEntryShortcut:
      shortcut.length > 0 ? shortcut : defaults.quickEntryShortcut,
    theme:
      theme === "light" || theme === "dark" || theme === "auto"
        ? theme
        : defaults.theme,
  };
}
