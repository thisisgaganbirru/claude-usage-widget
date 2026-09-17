/**
 * Argument validation for everything that crosses the IPC boundary.
 *
 * A renderer is untrusted, so a handler must never assume its arguments have
 * the type the TypeScript signature claims. These validators are the only
 * place that assumption gets checked, and they are pure so they can be tested
 * without Electron.
 */
import type {
  ProviderSettings,
  ProviderType,
  SettingsPatch,
  WidgetSettings,
} from "@shared/types";
import { isProviderId, type ProviderId } from "@shared/usage";

export const PROVIDERS: readonly ProviderType[] = ["claude", "chatgpt"];

export const THEMES: readonly WidgetSettings["theme"][] = [
  "light",
  "dark",
  "auto",
];

/** Longest quick-entry accelerator we will store, e.g. "Control+Alt+Shift+F12". */
export const MAX_SHORTCUT_LENGTH = 64;

/** Longest URL we will even consider handing to the external-open allowlist. */
export const MAX_URL_LENGTH = 2048;

/** Largest account id we accept; real ids are UUID-shaped. */
export const MAX_ACCOUNT_ID_LENGTH = 128;

export function isProvider(value: unknown): value is ProviderType {
  return typeof value === "string" && PROVIDERS.includes(value as ProviderType);
}

/**
 * The provider argument, defaulted. Handlers that operate on "the current
 * provider" use this so a missing argument stays valid.
 */
export function toProvider(
  value: unknown,
  fallback: ProviderType = "claude",
): ProviderType {
  return isProvider(value) ? value : fallback;
}

/** The provider argument where "all providers" is a legal answer. */
export function toOptionalProvider(value: unknown): ProviderType | undefined {
  return isProvider(value) ? value : undefined;
}

/**
 * Any provider id, including the ones this app reads locally rather than
 * logging into. `undefined` means "all of them" at every call site.
 */
export function toOptionalProviderId(value: unknown): ProviderId | undefined {
  return isProviderId(value) ? value : undefined;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isAccountId(value: unknown): value is string {
  return (
    isNonEmptyString(value) && (value as string).length <= MAX_ACCOUNT_ID_LENGTH
  );
}

export function isExternalUrlCandidate(value: unknown): value is string {
  return isNonEmptyString(value) && (value as string).length <= MAX_URL_LENGTH;
}

/** A window dimension: a finite, positive, sane number of pixels. */
export function isWindowDimension(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 1 && value <= 10000;
}

function isThresholdList(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    value.every((entry) => isFiniteNumber(entry) && entry > 0 && entry <= 100)
  );
}

/**
 * One provider block from an untrusted patch. A field the renderer left out
 * stays out, so the merge in SettingsManager keeps the stored value rather
 * than silently resetting it to a default.
 */
function pickProviderBlock(value: unknown): Partial<ProviderSettings> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const input = value as Record<string, unknown>;
  const block: Partial<ProviderSettings> = {};

  if (typeof input.enabled === "boolean") block.enabled = input.enabled;
  if (isFiniteNumber(input.intervalSec)) block.intervalSec = input.intervalSec;
  if (isThresholdList(input.thresholds)) {
    block.thresholds = [...input.thresholds];
  }

  return Object.keys(block).length > 0 ? block : null;
}

function pickProviders(value: unknown): SettingsPatch["providers"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const picked: Partial<Record<ProviderId, Partial<ProviderSettings>>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isProviderId(key)) continue;
    const block = pickProviderBlock(raw);
    if (block !== null) picked[key] = block;
  }

  return Object.keys(picked).length > 0 ? picked : undefined;
}

/**
 * Take an untrusted object and return only the settings keys we recognise,
 * each one type-checked. Unknown keys are dropped rather than merged, so a
 * compromised renderer cannot write arbitrary data into the settings store.
 *
 * Range clamping still belongs to normalizeSettings; this decides membership.
 */
export function pickSettingsPatch(value: unknown): SettingsPatch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  const patch: SettingsPatch = {};

  const providers = pickProviders(input.providers);
  if (providers !== undefined) patch.providers = providers;

  if (typeof input.enableDesktopNotifications === "boolean") {
    patch.enableDesktopNotifications = input.enableDesktopNotifications;
  }
  if (typeof input.enableBannerNotifications === "boolean") {
    patch.enableBannerNotifications = input.enableBannerNotifications;
  }
  if (typeof input.startOnBoot === "boolean") {
    patch.startOnBoot = input.startOnBoot;
  }
  if (typeof input.keepInTray === "boolean") {
    patch.keepInTray = input.keepInTray;
  }
  if (
    typeof input.quickEntryShortcut === "string" &&
    input.quickEntryShortcut.length <= MAX_SHORTCUT_LENGTH
  ) {
    patch.quickEntryShortcut = input.quickEntryShortcut;
  }
  if (
    typeof input.theme === "string" &&
    THEMES.includes(input.theme as WidgetSettings["theme"])
  ) {
    patch.theme = input.theme as WidgetSettings["theme"];
  }

  return patch;
}
