/**
 * Turns `copilot_internal/user` into normalized windows.
 *
 * Three things about this response have bitten every client that reads it, and
 * each one is handled explicitly below:
 *
 * - **Placeholder snapshots.** GitHub returns `entitlement: 0, remaining: 0`
 *   for token-based-billing and some Business seats, sometimes with
 *   `percent_remaining: 100`. Rendered naively that is a full green bar for a
 *   quota nobody is metering, so those rows are dropped.
 * - **Numbers arrive as numbers or as strings.** Both are read.
 * - **Unknown snapshot keys.** New quotas appear without warning, so an
 *   unrecognised key is labelled from its own name rather than skipped.
 *
 * `credits_used` is deliberately never summed across snapshots: GitHub reports
 * the same pool under more than one key, and adding them double-counts.
 *
 * Pure: no filesystem, no network, no clock beyond the timestamps passed in.
 */
import {
  clampPercent,
  type ProviderUsage,
  type UsageWindow,
} from "@shared/usage";
import { isPlainObject, schemaError } from "../schema";

/** Snapshot keys we have labels for, in display order. */
const KNOWN_SNAPSHOTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "premium_interactions", label: "Premium requests" },
  { key: "chat", label: "Chat" },
  { key: "completions", label: "Completions" },
];

const MAX_PLAN_LENGTH = 24;

/** A number stated as a number or as a string. Anything else is absent. */
export function readNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A quota GitHub is not actually metering. `unlimited` says so outright; an
 * entitlement of zero with nothing remaining is the same thing said badly.
 */
export function isPlaceholder(snapshot: Record<string, unknown>): boolean {
  if (snapshot.unlimited === true) return true;
  const entitlement = readNumber(snapshot.entitlement);
  const remaining = readNumber(snapshot.remaining);
  if (entitlement === null) return true;
  if (entitlement > 0) return false;
  return remaining === null || remaining <= 0;
}

/** Percent used, from the percentage the response states or from the counts. */
function usedPercentOf(snapshot: Record<string, unknown>): number | null {
  const percentRemaining = readNumber(snapshot.percent_remaining);
  if (percentRemaining !== null) return clampPercent(100 - percentRemaining);

  const entitlement = readNumber(snapshot.entitlement);
  const remaining =
    readNumber(snapshot.remaining) ?? readNumber(snapshot.quota_remaining);
  if (entitlement === null || entitlement <= 0 || remaining === null) {
    return null;
  }
  return clampPercent(((entitlement - remaining) / entitlement) * 100);
}

/** Turns a snapshot key nobody has labelled into something readable. */
export function labelForKey(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  if (words.length === 0) return "Quota";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * `quota_reset_date` is a plain date, e.g. "2026-10-01". Read as UTC midnight,
 * which is what the countdown wants; a time zone the response does not state
 * is not one to invent.
 */
export function readResetDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00Z`
    : trimmed;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function readPlan(root: Record<string, unknown>): string | null {
  const raw = root.copilot_plan;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, MAX_PLAN_LENGTH);
  if (trimmed.length === 0) return null;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * The pre-snapshot fields, for an account the current shape does not cover.
 * `limited_user_quotas` counts what is *left*, not what is used, which is the
 * kind of thing worth a comment rather than a rediscovery.
 */
function legacyWindows(root: Record<string, unknown>): UsageWindow[] {
  const monthly = root.monthly_quotas;
  const remainingQuotas = root.limited_user_quotas;
  if (!isPlainObject(monthly) || !isPlainObject(remainingQuotas)) return [];

  const windows: UsageWindow[] = [];
  for (const [key, rawLimit] of Object.entries(monthly)) {
    const limit = readNumber(rawLimit);
    const remaining = readNumber(remainingQuotas[key]);
    if (limit === null || limit <= 0 || remaining === null) continue;
    windows.push({
      id: key,
      label: labelForKey(key),
      usedPercent: clampPercent(((limit - remaining) / limit) * 100),
      resetsAt: readResetDate(root.quota_reset_date),
    });
  }
  return windows;
}

export interface NormalizeCopilotOptions {
  accountLabel: string;
  fetchedAt: string;
}

export function normalizeCopilotUsage(
  json: unknown,
  options: NormalizeCopilotOptions,
): ProviderUsage {
  if (!isPlainObject(json))
    throw schemaError("copilot_internal/user", "an object");

  const resetsAt = readResetDate(json.quota_reset_date);
  const snapshots = isPlainObject(json.quota_snapshots)
    ? json.quota_snapshots
    : {};

  const known = new Set(KNOWN_SNAPSHOTS.map((entry) => entry.key));
  const ordered = [
    ...KNOWN_SNAPSHOTS,
    ...Object.keys(snapshots)
      .filter((key) => !known.has(key))
      .map((key) => ({ key, label: labelForKey(key) })),
  ];

  const windows: UsageWindow[] = [];
  for (const { key, label } of ordered) {
    const snapshot = snapshots[key];
    if (!isPlainObject(snapshot)) continue;
    if (isPlaceholder(snapshot)) continue;
    const usedPercent = usedPercentOf(snapshot);
    if (usedPercent === null) continue;
    windows.push({ id: key, label, usedPercent, resetsAt });
  }

  if (windows.length === 0) windows.push(...legacyWindows(json));

  // Unlike the other providers, an empty list here is legitimate: a Business
  // seat with every quota unlimited reports exactly this, and the card saying
  // "no usage reported" is the truth rather than a parse failure.
  return {
    providerId: "copilot",
    accountLabel: options.accountLabel,
    plan: readPlan(json),
    windows,
    fetchedAt: options.fetchedAt,
  };
}
