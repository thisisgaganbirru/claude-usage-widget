/**
 * Turns Cursor's usage summary into normalized windows.
 *
 * Cursor has no published API for this. The summary endpoint is the one its
 * own dashboard calls, and its shape has changed more than once: an older
 * build reported per-model request counts, a newer one reports spend in cents
 * against a limit, and some accounts carry both. Rather than pin one shape and
 * break on the next change, this reads whichever it finds and keeps going.
 *
 * Because the shape is unpinned, "found nothing" needs care. An account with
 * usage-based pricing switched off legitimately has no metered ceiling, so an
 * empty window list is a real answer. A response carrying no Cursor marker at
 * all is not: that is the endpoint having changed under us, and it raises a
 * schema error naming the endpoint so the failure is legible instead of
 * showing up as a permanently empty card.
 *
 * Pure: no filesystem, no network, no clock beyond the timestamps passed in.
 */
import {
  clampPercent,
  type ProviderUsage,
  type UsageWindow,
} from "@shared/usage";
import { isPlainObject, schemaError } from "../schema";

/** Keys that have held the amount spent, across the shapes seen so far. */
const USED_CENTS_KEYS = [
  "usedCents",
  "totalCents",
  "currentUsageCents",
  "individualUsedCents",
] as const;

/** Keys that have held the ceiling. */
const LIMIT_CENTS_KEYS = [
  "limitCents",
  "hardLimitCents",
  "spendLimitCents",
  "individualLimitCents",
] as const;

/** Fields that say "this is a Cursor usage summary" even with nothing metered. */
const MARKER_KEYS = [
  "startOfMonth",
  "membershipType",
  "activeSubscription",
  "individualUsage",
  "teamUsage",
] as const;

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

function firstNumber(
  source: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = readNumber(source[key]);
    if (value !== null) return value;
  }
  return null;
}

/**
 * The next billing reset. Cursor states the period start, not its end, so the
 * end is a month on from it. A period starting on the 31st has no 31st to land
 * on in a shorter month, and clamping to that month's last day is what the
 * billing does.
 */
export function addOneMonth(iso: string): string | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;

  const start = new Date(parsed);
  const day = start.getUTCDate();
  const next = new Date(start.getTime());
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);

  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next.toISOString();
}

function readResetsAt(root: Record<string, unknown>): string | null {
  const start = root.startOfMonth;
  if (typeof start !== "string" || start.trim().length === 0) return null;
  return addOneMonth(start.trim());
}

/** A spend window, when the scope carries both a spend and a ceiling. */
function centsWindow(
  scope: Record<string, unknown>,
  id: string,
  label: string,
  resetsAt: string | null,
): UsageWindow | null {
  const limit = firstNumber(scope, LIMIT_CENTS_KEYS);
  const used = firstNumber(scope, USED_CENTS_KEYS);
  if (limit === null || limit <= 0 || used === null) return null;
  return {
    id,
    label,
    usedPercent: clampPercent((used / limit) * 100),
    resetsAt,
  };
}

/**
 * The older per-model shape: each key is a model name whose value carries a
 * request count and a ceiling. `maxRequestUsage` is null for a model on an
 * unlimited plan, which is a row with no percentage to draw.
 */
function modelWindows(
  root: Record<string, unknown>,
  resetsAt: string | null,
): UsageWindow[] {
  const windows: UsageWindow[] = [];
  for (const [key, value] of Object.entries(root)) {
    if (!isPlainObject(value)) continue;
    const used = readNumber(value.numRequests);
    const limit = readNumber(value.maxRequestUsage);
    if (used === null || limit === null || limit <= 0) continue;
    windows.push({
      id: key,
      label: key,
      usedPercent: clampPercent((used / limit) * 100),
      resetsAt,
      model: key,
    });
  }
  return windows;
}

function readPlan(
  root: Record<string, unknown>,
  fallback: string | null,
): string | null {
  const raw = root.membershipType;
  const source = typeof raw === "string" ? raw : (fallback ?? "");
  const trimmed = source.trim().replace(/_/g, " ").slice(0, MAX_PLAN_LENGTH);
  if (trimmed.length === 0) return null;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export interface NormalizeCursorOptions {
  accountLabel: string;
  /** The membership Cursor cached locally, used when the response omits it. */
  membership: string | null;
  fetchedAt: string;
}

export function normalizeCursorUsage(
  json: unknown,
  options: NormalizeCursorOptions,
): ProviderUsage {
  if (!isPlainObject(json)) throw schemaError("usage-summary", "an object");

  const resetsAt = readResetsAt(json);
  const windows: UsageWindow[] = [];

  const individual = isPlainObject(json.individualUsage)
    ? json.individualUsage
    : json;
  const individualWindow = centsWindow(
    individual,
    "individual",
    "Monthly spend",
    resetsAt,
  );
  if (individualWindow !== null) windows.push(individualWindow);

  if (isPlainObject(json.teamUsage)) {
    const team = centsWindow(json.teamUsage, "team", "Team spend", resetsAt);
    if (team !== null) windows.push(team);
  }

  windows.push(...modelWindows(json, resetsAt));

  const recognised =
    windows.length > 0 || MARKER_KEYS.some((key) => key in json);
  if (!recognised) {
    throw schemaError("usage-summary", "a Cursor usage summary");
  }

  return {
    providerId: "cursor",
    accountLabel: options.accountLabel,
    plan: readPlan(json, options.membership),
    windows,
    fetchedAt: options.fetchedAt,
  };
}
