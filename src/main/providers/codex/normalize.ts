/**
 * Turns a Codex rate-limit snapshot into normalized windows.
 *
 * Codex reports the same snapshot in two casings. The rollout files and the
 * HTTP API use snake_case (`used_percent`, `window_minutes`, `resets_at`);
 * the app-server's v2 protocol uses camelCase and renames one of the three
 * (`usedPercent`, `windowDurationMins`, `resetsAt`). Every other client that
 * reads this data decodes both, because a machine can have a CLI on either
 * side of that rename. So does this.
 *
 * Pure: no filesystem, no clock beyond the timestamps passed in.
 */
import {
  clampPercent,
  WINDOW_MINUTES_5H,
  WINDOW_MINUTES_7D,
  WINDOW_MINUTES_30D,
  type ProviderUsage,
  type UsageWindow,
} from "@shared/usage";
import { isPlainObject, schemaError } from "../schema";

/** Longest plan string we will render. The value comes from the vendor. */
const MAX_PLAN_LENGTH = 24;

/**
 * Timestamps arrive as Unix seconds. A value past this is milliseconds from a
 * client that got the unit wrong, which is worth surviving: the alternative is
 * a reset date in the year 58000.
 */
const MILLISECOND_THRESHOLD = 1e12;

interface RateLimitWindow {
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: string | null;
}

function unixToIso(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw schemaError(path, "a Unix timestamp or null");
  }
  if (value <= 0) return null;
  const ms = value > MILLISECOND_THRESHOLD ? value : value * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) throw schemaError(path, "a valid date");
  return date.toISOString();
}

/** The first key present, so one reader covers both casings. */
function pick(
  parent: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    const value = parent[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

export function readRateLimitWindow(
  parent: Record<string, unknown>,
  key: string,
  path: string,
): RateLimitWindow | null {
  const raw = parent[key];
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) throw schemaError(path, "an object or null");

  const used = pick(raw, ["used_percent", "usedPercent"]);
  if (typeof used !== "number" || !Number.isFinite(used)) {
    throw schemaError(`${path}.used_percent`, "a finite number");
  }

  const minutes = pick(raw, ["window_minutes", "windowDurationMins"]);
  if (
    minutes !== null &&
    (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0)
  ) {
    throw schemaError(`${path}.window_minutes`, "a positive number or null");
  }

  return {
    usedPercent: clampPercent(used),
    windowMinutes: typeof minutes === "number" ? minutes : null,
    resetsAt: unixToIso(
      pick(raw, ["resets_at", "resetsAt"]),
      `${path}.resets_at`,
    ),
  };
}

/**
 * Name a window by how long it is rather than by which slot it came from.
 *
 * Codex's "primary" window has been 5 hours and has been 1 hour, and the
 * secondary is weekly for some plans. Labelling from the reported duration
 * means the card stays right when the vendor retunes a window, where
 * "5h session" hardcoded to the primary slot would quietly start lying.
 */
export function labelForMinutes(
  minutes: number | null,
  fallback: string,
): string {
  if (minutes === null) return fallback;
  if (minutes === WINDOW_MINUTES_5H) return "5h limit";
  if (minutes === WINDOW_MINUTES_7D) return "7d weekly";
  if (minutes === WINDOW_MINUTES_30D) return "30d limit";
  if (minutes % (60 * 24) === 0) return `${minutes / (60 * 24)}d limit`;
  if (minutes % 60 === 0) return `${minutes / 60}h limit`;
  return `${Math.round(minutes)}m limit`;
}

function readPlan(parent: Record<string, unknown>): string | null {
  const raw = pick(parent, ["plan_type", "planType"]);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, MAX_PLAN_LENGTH);
  if (trimmed.length === 0) return null;
  // "plus" and "pro" are what the field carries; the UI wants a label.
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export interface NormalizeCodexOptions {
  accountLabel: string;
  /** When the snapshot was recorded, not when we read it. */
  fetchedAt: string;
  /** Used only when the snapshot carries no plan of its own. */
  plan?: string | null;
}

/**
 * A snapshot with neither window is not an account at zero: it is a shape we
 * did not understand, and reporting zero would paint the tray green on a bad
 * read. An empty `windows` list is reserved for "Codex is installed but has
 * not recorded a limit yet", which the provider produces deliberately.
 */
export function normalizeCodexSnapshot(
  snapshot: unknown,
  options: NormalizeCodexOptions,
): ProviderUsage {
  if (!isPlainObject(snapshot)) throw schemaError("rate_limits", "an object");

  const windows: UsageWindow[] = [];

  const primary = readRateLimitWindow(snapshot, "primary", "primary");
  if (primary !== null) {
    windows.push({
      id: "primary",
      label: labelForMinutes(primary.windowMinutes, "Primary limit"),
      usedPercent: primary.usedPercent,
      resetsAt: primary.resetsAt,
      ...(primary.windowMinutes !== null
        ? { windowMinutes: primary.windowMinutes }
        : {}),
    });
  }

  const secondary = readRateLimitWindow(snapshot, "secondary", "secondary");
  if (secondary !== null) {
    windows.push({
      id: "secondary",
      label: labelForMinutes(secondary.windowMinutes, "Secondary limit"),
      usedPercent: secondary.usedPercent,
      resetsAt: secondary.resetsAt,
      ...(secondary.windowMinutes !== null
        ? { windowMinutes: secondary.windowMinutes }
        : {}),
    });
  }

  if (windows.length === 0) {
    throw schemaError("rate_limits", "a snapshot with a primary or secondary");
  }

  return {
    providerId: "codex",
    accountLabel: options.accountLabel,
    plan: readPlan(snapshot) ?? options.plan ?? null,
    windows,
    fetchedAt: options.fetchedAt,
  };
}
