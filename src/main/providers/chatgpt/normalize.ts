/**
 * Turns ChatGPT's `chat-requirements` and account-check responses into windows.
 *
 * ChatGPT publishes no usage endpoint, so unlike the Claude provider this one
 * cannot assert a shape: it searches the response for an object carrying a
 * limit and a used count. What it does NOT do is invent the fields it fails to
 * find. The previous implementation defaulted a missing reset time to "three
 * hours from now" and copied the session percentage into the weekly slot, so
 * the UI showed two confident numbers that the vendor never sent. A window we
 * cannot read is a window we do not emit.
 */
import {
  clampPercent,
  type ProviderUsage,
  type UsageWindow,
} from "@shared/usage";
import { isPlainObject } from "../schema";
import { ProviderError } from "../types";

function readNumber(
  object: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function readString(
  object: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function readIsoDate(
  object: Record<string, unknown>,
  keys: string[],
): string | null {
  const raw = readString(object, keys);
  if (raw === null) return null;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

/** Every object anywhere in the response, breadth of shape unknown. */
export function collectObjects(value: unknown): Record<string, unknown>[] {
  if (!isPlainObject(value) && !Array.isArray(value)) return [];
  const stack: unknown[] = [value];
  const objects: Record<string, unknown>[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (!isPlainObject(current)) continue;
    objects.push(current);
    for (const nested of Object.values(current)) stack.push(nested);
  }
  return objects;
}

const LIMIT_KEYS = ["limit", "max", "cap", "total"];
const USED_KEYS = ["used", "consumed", "current_usage"];
const REMAINING_KEYS = ["remaining", "left", "available"];
const RESET_KEYS = ["reset_at", "resetAt", "resets_at", "resetsAt"];

interface Quota {
  usedPercent: number;
  resetsAt: string | null;
  limit: number;
}

/** A limit plus a used count, however the object happens to spell them. */
function readQuota(object: Record<string, unknown>): Quota | null {
  const limit = readNumber(object, LIMIT_KEYS);
  const used = readNumber(object, USED_KEYS);
  const remaining = readNumber(object, REMAINING_KEYS);

  const resolvedLimit =
    limit ?? (remaining !== null && used !== null ? remaining + used : null);
  const resolvedUsed =
    used ??
    (resolvedLimit !== null && remaining !== null
      ? Math.max(0, resolvedLimit - remaining)
      : null);

  if (resolvedLimit === null || resolvedUsed === null) return null;
  if (resolvedLimit <= 0) return null;

  return {
    usedPercent: clampPercent((resolvedUsed / resolvedLimit) * 100),
    resetsAt: readIsoDate(object, RESET_KEYS),
    limit: resolvedLimit,
  };
}

const WEEKLY_LIMIT_KEYS = ["weekly_limit", "weekly_cap", "seven_day_limit"];
const WEEKLY_USED_KEYS = ["weekly_used", "seven_day_used"];
const WEEKLY_RESET_KEYS = ["weekly_reset_at", "seven_day_reset_at"];

function readWeeklyQuota(object: Record<string, unknown>): Quota | null {
  const limit = readNumber(object, WEEKLY_LIMIT_KEYS);
  const used = readNumber(object, WEEKLY_USED_KEYS);
  if (limit === null || used === null || limit <= 0) return null;
  return {
    usedPercent: clampPercent((used / limit) * 100),
    resetsAt: readIsoDate(object, WEEKLY_RESET_KEYS),
    limit,
  };
}

const MODEL_NAME_KEYS = ["model", "slug", "name"];

/**
 * A model name is the one label here that comes from the vendor rather than
 * from us, and it is rendered in the UI. Cap it so a response carrying a
 * paragraph where a slug belongs cannot stretch the card or a notification.
 */
const MAX_MODEL_NAME_LENGTH = 48;

function readModelName(object: Record<string, unknown>): string | null {
  const name = readString(object, MODEL_NAME_KEYS);
  if (name === null) return null;
  return name.length > MAX_MODEL_NAME_LENGTH
    ? `${name.slice(0, MAX_MODEL_NAME_LENGTH - 1)}…`
    : name;
}

function readModelWindows(
  objects: Record<string, unknown>[],
  exclude: Record<string, unknown>,
): UsageWindow[] {
  const windows: UsageWindow[] = [];
  const seen = new Set<string>();

  for (const object of objects) {
    // The object behind the top-level window would otherwise come back a
    // second time as a per-model breakdown of itself.
    if (object === exclude) continue;
    const name = readModelName(object);
    if (name === null || seen.has(name)) continue;
    const quota = readQuota(object);
    if (quota === null) continue;
    seen.add(name);
    windows.push({
      id: `model-${name}`,
      label: name,
      usedPercent: quota.usedPercent,
      resetsAt: quota.resetsAt,
      model: name,
    });
  }

  return windows;
}

export interface ChatGptAccount {
  accountLabel: string | null;
  plan: string | null;
}

const ACCOUNT_NAME_KEYS = ["name", "display_name", "email"];
const PLAN_KEYS = ["plan_type", "plan", "subscription", "account_plan"];

export function parseChatGptAccount(data: unknown): ChatGptAccount {
  for (const object of collectObjects(data)) {
    const accountLabel = readString(object, ACCOUNT_NAME_KEYS);
    const plan = readString(object, PLAN_KEYS);
    if (accountLabel !== null || plan !== null) return { accountLabel, plan };
  }
  return { accountLabel: null, plan: null };
}

export interface NormalizeChatGptOptions {
  account: ChatGptAccount;
  fetchedAt: string;
}

export function normalizeChatGptUsage(
  requirements: unknown,
  options: NormalizeChatGptOptions,
): ProviderUsage {
  const objects = collectObjects(requirements);

  // The response nests several quota-shaped objects; the one with the largest
  // limit is the account-level message quota rather than a per-feature cap.
  const quotas = objects
    .map((object) => ({ object, quota: readQuota(object) }))
    .filter(
      (entry): entry is { object: Record<string, unknown>; quota: Quota } =>
        entry.quota !== null,
    )
    .sort((a, b) => b.quota.limit - a.quota.limit);

  if (quotas.length === 0) {
    throw new ProviderError(
      "schema",
      "ChatGPT response contained no recognizable message limit",
      { context: "chat-requirements" },
    );
  }

  const primary = quotas[0];
  const windows: UsageWindow[] = [
    {
      id: "session",
      label: "Messages",
      usedPercent: primary.quota.usedPercent,
      resetsAt: primary.quota.resetsAt,
    },
  ];

  for (const entry of quotas) {
    const weekly = readWeeklyQuota(entry.object);
    if (weekly === null) continue;
    windows.push({
      id: "weekly",
      label: "7d weekly",
      usedPercent: weekly.usedPercent,
      resetsAt: weekly.resetsAt,
    });
    break;
  }

  windows.push(...readModelWindows(objects, primary.object));

  return {
    providerId: "chatgpt",
    accountLabel: options.account.accountLabel ?? "ChatGPT account",
    plan: options.account.plan,
    windows,
    fetchedAt: options.fetchedAt,
  };
}
