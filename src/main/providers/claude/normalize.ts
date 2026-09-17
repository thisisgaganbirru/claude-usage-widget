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

/**
 * The `limits[]` entries that are per-model weekly rows. Anything else in that
 * array mirrors `five_hour` or `seven_day` and would render twice.
 */
const SCOPED_KIND = "weekly_scoped";
const SCOPED_GROUP = "weekly";

/**
 * The row covering every model duplicates the main weekly bar, so it is
 * dropped rather than shown beside it.
 */
const ALL_MODELS_SLUG = "all-models";

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

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Per-model weekly windows from `limits[]`.
 *
 * This array is the current mechanism for per-model limits; the legacy
 * `seven_day_opus` and `seven_day_sonnet` fields have already gone null on
 * some accounts. Rows are keyed on `scope.model.id`, which is the stable
 * identifier, falling back to the display name when a row carries only that.
 *
 * Anything malformed is skipped rather than thrown on: this is a supplementary
 * breakdown, and losing one row should not cost the reading.
 */
export function parseScopedLimits(
  root: Record<string, unknown>,
): UsageWindow[] {
  const raw = root.limits;
  if (!Array.isArray(raw)) return [];

  const windows: UsageWindow[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (row.kind !== SCOPED_KIND || row.group !== SCOPED_GROUP) continue;
    // An inactive limit is one the account is not currently metered against.
    if (row.is_active === false) continue;

    const percent = row.percent;
    if (typeof percent !== "number" || !Number.isFinite(percent)) continue;

    const scope = row.scope;
    if (typeof scope !== "object" || scope === null) continue;
    const model = (scope as Record<string, unknown>).model;
    if (typeof model !== "object" || model === null) continue;

    const modelRecord = model as Record<string, unknown>;
    const id = typeof modelRecord.id === "string" ? modelRecord.id : null;
    const displayName =
      typeof modelRecord.display_name === "string"
        ? modelRecord.display_name
        : null;

    const slug = slugify(id ?? displayName ?? "");
    if (slug.length === 0 || slug === ALL_MODELS_SLUG) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);

    const resetsAt =
      typeof row.resets_at === "string" &&
      !Number.isNaN(Date.parse(row.resets_at))
        ? new Date(row.resets_at).toISOString()
        : null;

    windows.push({
      id: `weekly-${slug}`,
      label: `7d ${displayName ?? slug}`,
      usedPercent: clampPercent(percent),
      resetsAt,
      windowMinutes: WINDOW_MINUTES_7D,
      model: slug,
    });
  }

  return windows;
}

/**
 * The plan a rate-limit tier names. The tier string is the better of the two
 * hints the vendor gives: it distinguishes Max 5x from Max 20x, which neither
 * `subscriptionType` nor `extra_usage` does.
 */
export function planFromTier(tier: string | null | undefined): string | null {
  if (typeof tier !== "string") return null;
  const lower = tier.toLowerCase();
  if (lower.includes("max")) {
    const multiplier = /max[_-]?(\d+)x/.exec(lower);
    return multiplier === null ? "Max" : `Max ${multiplier[1]}x`;
  }
  if (lower.includes("enterprise")) return "Enterprise";
  if (lower.includes("team")) return "Team";
  if (lower.includes("pro")) return "Pro";
  return null;
}

export interface NormalizeClaudeUsageOptions {
  /** Org name from `/api/organizations`, shown as the account label. */
  accountLabel: string;
  /** ISO timestamp for the fetch, injected so tests are deterministic. */
  fetchedAt: string;
  /** Plan resolved from the account or the credential, preferred when set. */
  plan?: string | null;
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

  const scoped = parseScopedLimits(root);
  windows.push(...scoped);

  // The legacy per-model fields and `limits[]` describe the same thing on an
  // account that reports both, so a legacy field only fills a gap `limits[]`
  // left rather than adding a second bar for the same model.
  const scopedModels = new Set(scoped.map((window) => window.model));
  for (const spec of MODEL_WINDOWS) {
    if (scopedModels.has(spec.model)) continue;
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
    plan: options.plan ?? detectPlan(root),
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

export interface ClaudeAccount {
  email: string | null;
  plan: string | null;
}

const EMPTY_ACCOUNT: ClaudeAccount = { email: null, plan: null };

/** Seat tiers that name the plan on their own. */
const SEAT_TIER_PLANS: Readonly<Record<string, string>> = {
  team_standard: "Team Standard",
  team_tier_1: "Team Premium",
};

function readOptionalString(
  parent: Record<string, unknown>,
  key: string,
): string | null {
  const value = parent[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Email and plan from `/api/account`.
 *
 * This is where the plan actually lives: `/api/organizations` carries only a
 * uuid, a name and capabilities. Nothing here is required, because losing it
 * costs a label rather than the reading, so every branch returns nulls instead
 * of throwing.
 *
 * There is no "free" tier in the response. An account with no plan resolved is
 * a free account, which the caller renders as such.
 */
export function parseClaudeAccount(
  json: unknown,
  orgUuid?: string,
): ClaudeAccount {
  if (typeof json !== "object" || json === null) return EMPTY_ACCOUNT;
  const root = json as Record<string, unknown>;

  const memberships = Array.isArray(root.memberships) ? root.memberships : [];
  const records = memberships.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );

  const matching =
    records.find((entry) => {
      const org = entry.organization;
      return (
        typeof org === "object" &&
        org !== null &&
        (org as Record<string, unknown>).uuid === orgUuid
      );
    }) ?? records[0];

  const email = readOptionalString(root, "email_address");
  if (matching === undefined) return { email, plan: null };

  const org =
    typeof matching.organization === "object" && matching.organization !== null
      ? (matching.organization as Record<string, unknown>)
      : {};

  const tier = readOptionalString(org, "rate_limit_tier");
  const seatTier = readOptionalString(matching, "seat_tier");
  const billing = readOptionalString(org, "billing_type");

  // A Stripe subscription on a Claude tier that named no plan of its own is a
  // Pro account: the tier string only spells out the plan above Pro.
  const stripePro =
    billing !== null &&
    billing.toLowerCase().includes("stripe") &&
    tier !== null &&
    tier.toLowerCase().includes("claude")
      ? "Pro"
      : null;

  const plan =
    planFromTier(tier) ??
    (seatTier === null ? null : (SEAT_TIER_PLANS[seatTier] ?? null)) ??
    stripePro;

  return { email, plan };
}

export interface ClaudeOauthProfile {
  email: string | null;
  orgUuid: string | null;
}

/** Account label and org id from `/api/oauth/profile`. Never throws. */
export function parseOauthProfile(json: unknown): ClaudeOauthProfile {
  if (typeof json !== "object" || json === null) {
    return { email: null, orgUuid: null };
  }
  const root = json as Record<string, unknown>;

  const account =
    typeof root.account === "object" && root.account !== null
      ? (root.account as Record<string, unknown>)
      : {};
  const organization =
    typeof root.organization === "object" && root.organization !== null
      ? (root.organization as Record<string, unknown>)
      : {};

  return {
    email: readOptionalString(account, "email_address"),
    orgUuid: readOptionalString(organization, "uuid"),
  };
}
