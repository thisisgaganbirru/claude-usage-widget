/**
 * Turns the `/api/organizations/{id}/usage` response into normalized windows.
 *
 * Pure: no Electron, no network, no clock beyond the `fetchedAt` passed in, so
 * every branch is reachable from a fixture test.
 *
 * The endpoint reports `utilization` as a percentage already, which is why no
 * limit is divided anywhere here. The previous code carried a `planLimit: 100`
 * alongside it and then computed `used / limit * 100`, which is the same number
 * with two extra ways to be wrong.
 */
import {
  clampPercent,
  WINDOW_MINUTES_5H,
  WINDOW_MINUTES_7D,
  type ProviderUsage,
  type UsageWindow,
} from "@shared/usage";
import {
  asObject,
  asString,
  optionalBoolean,
  optionalIsoDate,
  optionalNumber,
  optionalObject,
} from "../schema";
import { ProviderError } from "../types";

/** Per-model windows we know how to label, in display order. */
const MODEL_WINDOWS: ReadonlyArray<{
  key: string;
  id: string;
  label: string;
  model: string;
}> = [
  {
    key: "seven_day_opus",
    id: "weekly-opus",
    label: "7d Opus",
    model: "opus",
  },
  {
    key: "seven_day_sonnet",
    id: "weekly-sonnet",
    label: "7d Sonnet",
    model: "sonnet",
  },
];

function readWindow(
  root: Record<string, unknown>,
  key: string,
  path: string,
): { usedPercent: number; resetsAt: string | null } | null {
  const raw = optionalObject(root, key, path);
  if (raw === null) return null;
  const utilization = optionalNumber(raw, "utilization", `${path}.utilization`);
  if (utilization === null) return null;
  return {
    usedPercent: clampPercent(utilization),
    resetsAt: optionalIsoDate(raw, "resets_at", `${path}.resets_at`),
  };
}

/**
 * Reads the plan label. `extra_usage.is_enabled` marks an account that has
 * bought overflow capacity, which claude.ai presents as Pro+.
 */
export function detectPlan(root: Record<string, unknown>): string | null {
  const extra = optionalObject(root, "extra_usage", "extra_usage");
  if (extra === null) return null;
  const enabled = optionalBoolean(
    extra,
    "is_enabled",
    "extra_usage.is_enabled",
  );
  if (enabled === null) return null;
  return enabled ? "Pro+" : "Pro";
}

export interface NormalizeClaudeUsageOptions {
  /** Org name from `/api/organizations`, shown as the account label. */
  accountLabel: string;
  /** ISO timestamp for the fetch, injected so tests are deterministic. */
  fetchedAt: string;
}

export function normalizeClaudeUsage(
  json: unknown,
  options: NormalizeClaudeUsageOptions,
): ProviderUsage {
  const root = asObject(json, "usage");
  const windows: UsageWindow[] = [];

  const session = readWindow(root, "five_hour", "five_hour");
  if (session !== null) {
    windows.push({
      id: "session",
      label: "5h session",
      usedPercent: session.usedPercent,
      resetsAt: session.resetsAt,
      windowMinutes: WINDOW_MINUTES_5H,
    });
  }

  const weekly = readWindow(root, "seven_day", "seven_day");
  if (weekly !== null) {
    windows.push({
      id: "weekly",
      label: "7d weekly",
      usedPercent: weekly.usedPercent,
      resetsAt: weekly.resetsAt,
      windowMinutes: WINDOW_MINUTES_7D,
    });
  }

  // An account with neither window is a response we do not understand, not an
  // account at 0%: reporting zero would paint the tray green on a broken read.
  if (windows.length === 0) {
    throw new ProviderError(
      "schema",
      "Usage response contained neither five_hour nor seven_day",
      { context: "usage" },
    );
  }

  for (const spec of MODEL_WINDOWS) {
    const modelWindow = readWindow(root, spec.key, spec.key);
    if (modelWindow === null) continue;
    windows.push({
      id: spec.id,
      label: spec.label,
      usedPercent: modelWindow.usedPercent,
      resetsAt: modelWindow.resetsAt,
      windowMinutes: WINDOW_MINUTES_7D,
      model: spec.model,
    });
  }

  return {
    providerId: "claude",
    accountLabel: options.accountLabel,
    plan: detectPlan(root),
    windows,
    fetchedAt: options.fetchedAt,
  };
}

export interface ClaudeOrganization {
  uuid: string;
  name: string | null;
}

/**
 * Reads the first organization from `/api/organizations`. The trailing
 * "'s Organization" that claude.ai appends to personal accounts is dropped so
 * the card shows a name rather than a sentence.
 */
export function parseOrganizations(json: unknown): ClaudeOrganization {
  const list = Array.isArray(json) ? json : [json];
  const first = list[0];
  const org = asObject(first, "organizations[0]");
  const uuid = asString(org, "uuid", "organizations[0].uuid");
  if (uuid.length === 0) {
    throw new ProviderError("schema", "Organization uuid was empty", {
      context: "organizations[0].uuid",
    });
  }

  const rawName =
    typeof org.name === "string"
      ? org.name.replace(/'s Organization$/i, "").trim()
      : "";

  return { uuid, name: rawName.length > 0 ? rawName : null };
}
