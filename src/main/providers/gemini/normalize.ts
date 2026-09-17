/**
 * Turns Code Assist's tier and quota responses into normalized windows.
 *
 * Two endpoints feed this. `loadCodeAssist` names the tier the account is on,
 * which is the plan label. `retrieveUserQuota` reports, per model, the
 * fraction of the allowance still left.
 *
 * The fraction is *remaining*, so it is inverted here once rather than at
 * every call site. A model can appear more than once when it is metered under
 * more than one bucket; the smallest remaining fraction is what the user is
 * actually about to hit, so that is the one kept.
 *
 * Both endpoints are `v1internal` and neither is documented, so field names
 * are read in the several spellings that have been observed rather than
 * pinned to one.
 *
 * Pure: no filesystem, no network, no clock beyond the timestamps passed in.
 */
import {
  clampPercent,
  type ProviderUsage,
  type UsageWindow,
} from "@shared/usage";
import { isPlainObject, schemaError } from "../schema";

/** Keys that have held the list of per-model quotas. */
const QUOTA_LIST_KEYS = ["userQuotas", "quotas", "quotaInfos"] as const;
const FRACTION_KEYS = ["remainingFraction", "remaining_fraction"] as const;
const MODEL_KEYS = ["model", "modelId", "name"] as const;
const RESET_KEYS = ["resetTime", "resetsAt", "reset_time"] as const;

const MAX_PLAN_LENGTH = 32;
const MAX_MODEL_LENGTH = 48;

function firstString(
  source: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function firstFiniteNumber(
  source: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function firstArray(
  source: Record<string, unknown>,
  keys: readonly string[],
): unknown[] | null {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

function readIsoDate(value: string | null): string | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** "gemini-2.5-pro" reads better than nothing, but not much better. */
function labelForModel(model: string): string {
  return model.slice(0, MAX_MODEL_LENGTH);
}

/** The tier name `loadCodeAssist` reports, or its id when it has no name. */
export function planFromTier(json: unknown): string | null {
  if (!isPlainObject(json)) return null;
  const tier = json.currentTier;
  if (!isPlainObject(tier)) return null;

  const named = firstString(tier, ["name", "id"]);
  if (named === null) return null;
  const readable = named.replace(/[-_]+/g, " ").slice(0, MAX_PLAN_LENGTH);
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

/** The Cloud project the CLI is billing against, used as a fallback label. */
export function projectFromLoad(json: unknown): string | null {
  if (!isPlainObject(json)) return null;
  return firstString(json, ["cloudaicompanionProject", "project"]);
}

export interface NormalizeGeminiOptions {
  accountLabel: string;
  plan: string | null;
  fetchedAt: string;
}

export function normalizeGeminiQuota(
  json: unknown,
  options: NormalizeGeminiOptions,
): ProviderUsage {
  if (!isPlainObject(json)) throw schemaError("retrieveUserQuota", "an object");

  const entries = firstArray(json, QUOTA_LIST_KEYS);
  if (entries === null) {
    throw schemaError("retrieveUserQuota", "a list of per-model quotas");
  }

  // Worst remaining fraction per model: a model metered under two buckets is
  // limited by the tighter one.
  const worst = new Map<string, UsageWindow>();

  for (const entry of entries) {
    if (!isPlainObject(entry)) continue;
    const fraction = firstFiniteNumber(entry, FRACTION_KEYS);
    if (fraction === null) continue;

    const model = firstString(entry, MODEL_KEYS);
    if (model === null) continue;

    const window: UsageWindow = {
      id: model,
      label: labelForModel(model),
      usedPercent: clampPercent((1 - fraction) * 100),
      resetsAt: readIsoDate(firstString(entry, RESET_KEYS)),
      model,
    };

    const existing = worst.get(model);
    if (existing === undefined || window.usedPercent > existing.usedPercent) {
      worst.set(model, window);
    }
  }

  return {
    providerId: "gemini",
    accountLabel: options.accountLabel,
    plan: options.plan,
    windows: [...worst.values()],
    fetchedAt: options.fetchedAt,
  };
}
