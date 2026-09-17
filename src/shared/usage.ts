/**
 * The normalized usage model every provider returns.
 *
 * A quota is a list of windows. A window is a percentage used, a reset time,
 * and optionally the window length and a model tag. Per-model bars are windows
 * tagged with a model rather than fixed fields, so a vendor that reports three
 * models and a vendor that reports none both fit without a schema change.
 */

export type ProviderId =
  "claude" | "chatgpt" | "codex" | "copilot" | "cursor" | "gemini";

export const PROVIDER_IDS: readonly ProviderId[] = [
  "claude",
  "chatgpt",
  "codex",
  "copilot",
  "cursor",
  "gemini",
];

export function isProviderId(value: unknown): value is ProviderId {
  return (
    typeof value === "string" &&
    (PROVIDER_IDS as readonly string[]).includes(value)
  );
}

/** Window lengths the UI knows how to phrase, in minutes. */
export const WINDOW_MINUTES_5H = 300;
export const WINDOW_MINUTES_7D = 10080;
export const WINDOW_MINUTES_30D = 43200;

export interface UsageWindow {
  /** "session" | "weekly" | "monthly" | vendor-specific. Unique per provider. */
  id: string;
  /** Human label: "5h session", "7d weekly", "Premium requests". */
  label: string;
  /** 0..100, clamped by the provider. */
  usedPercent: number;
  /** ISO 8601, or null when the window has not started. */
  resetsAt: string | null;
  windowMinutes?: number;
  /** Set only on per-model sub-windows: "opus", "sonnet". */
  model?: string;
}

export interface ProviderUsage {
  providerId: ProviderId;
  /** Org name, email, or a plan string when the vendor gives no identity. */
  accountLabel: string;
  plan: string | null;
  windows: UsageWindow[];
  /** ISO 8601. */
  fetchedAt: string;
}

/**
 * What the UI shows for one provider. `staleSince` is set when the last
 * success is older than twice the poll interval: the data is still rendered,
 * dimmed, rather than replaced with an error.
 */
export type ProviderState =
  | { kind: "not-detected" }
  | { kind: "needs-auth"; hint: string }
  | { kind: "ok"; usage: ProviderUsage; staleSince?: string }
  | {
      kind: "error";
      code: ProviderErrorKind;
      message: string;
      retryAt: string;
    };

/**
 * Why a poll failed. The scheduler branches on this, so it is part of the
 * shared model rather than an implementation detail of one provider.
 */
export type ProviderErrorKind =
  "network" | "auth" | "rate-limited" | "schema" | "unknown";

/** Clamp a vendor-supplied percentage into the range the UI can render. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function highest(windows: UsageWindow[]): UsageWindow | null {
  let worst: UsageWindow | null = null;
  for (const window of windows) {
    if (worst === null || window.usedPercent > worst.usedPercent) {
      worst = window;
    }
  }
  return worst;
}

/**
 * The window a card leads with: the one closest to running out.
 *
 * Top-level windows win, because a provider that reports both a total and a
 * per-model breakdown means the total. But some providers report nothing but
 * per-model windows — Gemini reports one allowance per model and no overall
 * figure — so falling back to those is the difference between a real number
 * and a card that says "no usage reported" while the user is at 90%.
 */
export function worstWindow(windows: UsageWindow[]): UsageWindow | null {
  return highest(topLevelWindows(windows)) ?? highest(modelWindows(windows));
}

/** One provider's state, as the tray and the header summary receive it. */
export interface ProviderStateEntry {
  providerId: ProviderId;
  state: ProviderState;
}

/** The single worst window anywhere, and who reported it. */
export interface WorstAcross {
  providerId: ProviderId;
  window: UsageWindow;
  /** The reporting provider's data is older than twice its poll interval. */
  stale: boolean;
}

/**
 * The closest any enabled provider is to a wall.
 *
 * This is what the tray icon colours itself by, so the rule matters: a tray
 * that tracks whichever provider polled most recently tells the user nothing,
 * because the number changes meaning every few seconds. The highest used
 * percentage across everything reporting is a question the icon can actually
 * answer at a glance.
 *
 * Providers that are not reporting a number (not detected, needing a sign-in,
 * erroring) contribute nothing rather than a zero. A zero would drag the icon
 * green and say "plenty left" about a provider we cannot see at all.
 */
export function worstAcrossProviders(
  entries: readonly ProviderStateEntry[],
): WorstAcross | null {
  let found: WorstAcross | null = null;

  for (const entry of entries) {
    if (entry.state.kind !== "ok") continue;
    const window = worstWindow(entry.state.usage.windows);
    if (window === null) continue;
    if (found !== null && window.usedPercent <= found.window.usedPercent) {
      continue;
    }
    found = {
      providerId: entry.providerId,
      window,
      stale: entry.state.staleSince !== undefined,
    };
  }

  return found;
}

/** Windows that stand on their own, in the order the provider listed them. */
export function topLevelWindows(windows: UsageWindow[]): UsageWindow[] {
  return windows.filter((window) => window.model === undefined);
}

/** Per-model sub-windows, which render as a breakdown under the totals. */
export function modelWindows(windows: UsageWindow[]): UsageWindow[] {
  return windows.filter((window) => window.model !== undefined);
}
