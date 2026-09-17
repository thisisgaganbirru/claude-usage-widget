/**
 * One provider's row in the widget, at one of three densities.
 *
 * Every provider renders through this, so a vendor that reports three windows
 * and a vendor that reports one need no component of their own. The densities
 * map onto the widget sizes: "line" is the worst window and nothing else,
 * "card" adds the rest of the windows, "full" adds the per-model breakdown and
 * a reset time.
 */
import React from "react";
import { useProviderState } from "@renderer/hooks/useProviderState";
import { useNow } from "@renderer/hooks/useNow";
import { formatAgo, formatCountdown, formatResetIn } from "@renderer/format";
import { providerLabel } from "@shared/provider-labels";
import { hasLoginFlow } from "@shared/types";
import type { ProviderId, UsageWindow } from "@shared/usage";
import {
  fillClassFor,
  longestWindow,
  ModelWindowList,
  ProgressBar,
  ProviderStatus,
  UsageWindowRow,
} from "./UsageWindows";

export type CardDensity = "line" | "card" | "full";

interface ProviderCardProps {
  providerId: ProviderId;
  density: CardDensity;
  /** Offered only for a provider that has a sign-in flow to offer. */
  onSignIn?: (providerId: ProviderId) => void;
}

/** Name, plan and the badges that qualify the number beside them. */
function CardHeading({
  providerId,
  plan,
  isStale,
  isRefreshing,
  onRefresh,
}: {
  providerId: ProviderId;
  plan: string | null;
  isStale: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}): React.ReactElement {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <span className="text-[11px] font-semibold text-fg">
        {providerLabel(providerId)}
      </span>

      {plan ? (
        <span className="select-none rounded-[20px] border border-fg/10 bg-fg/[0.07] px-[6px] py-px text-[9px] font-medium text-fg/45">
          {plan}
        </span>
      ) : null}

      {/* Stale means the numbers are real but old, so they stay on screen
          qualified rather than being replaced by an error. */}
      {isStale ? (
        <span
          title="This reading is out of date"
          className="select-none rounded-[20px] border border-amber-400/20 bg-amber-400/10 px-[6px] py-px text-[9px] font-medium text-amber-300/70"
        >
          stale
        </span>
      ) : null}

      <button
        onClick={onRefresh}
        title={`Refresh ${providerLabel(providerId)}`}
        className={`ml-auto text-[11px] leading-none text-fg/30 transition-colors hover:text-fg/60 ${
          isRefreshing ? "animate-spin-slow" : ""
        }`}
      >
        ↻
      </button>
    </div>
  );
}

/** The one-line form: a label, a percentage, and a bar under both. */
function WorstLine({
  label,
  usedPercent,
  resetsAt,
}: {
  label: string;
  usedPercent: number;
  resetsAt: string | null;
}): React.ReactElement {
  const resetsIn = formatResetIn(resetsAt);

  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] text-fg/45">{label}</span>
        <span className="text-[10px] tabular-nums text-fg/45">
          {Math.round(usedPercent)}%{resetsIn === null ? "" : ` · ${resetsIn}`}
        </span>
      </div>
      <ProgressBar
        percent={usedPercent}
        trackClass="fill-fg/10"
        fillClass={fillClassFor(usedPercent)}
        height={5}
      />
    </>
  );
}

/** A live countdown to the longest window's reset, ticking once a second. */
function Countdown({ window }: { window: UsageWindow }): React.ReactElement {
  const now = useNow();

  return (
    <div className="mt-1.5 flex items-center justify-between rounded-[8px] bg-fg/5 px-2.5 py-1.5">
      <span className="text-[9px] font-medium uppercase tracking-[0.04em] text-fg/35">
        {window.label} resets in
      </span>
      <span className="text-[11px] tabular-nums tracking-[0.03em] text-[#C15F3C]">
        {formatCountdown(window.resetsAt, now)}
      </span>
    </div>
  );
}

/**
 * What a provider with no reading offers to do about it.
 *
 * A provider with a sign-in flow gets a button. One that reads another tool's
 * credential file gets the status text alone, because there is nothing this
 * app can do for it: the fix is to sign in to that tool.
 */
function EmptyState({
  providerId,
  state,
  onSignIn,
}: {
  providerId: ProviderId;
  state: ReturnType<typeof useProviderState>["state"];
  onSignIn?: (providerId: ProviderId) => void;
}): React.ReactElement {
  const canSignIn =
    state.kind === "needs-auth" && hasLoginFlow(providerId) && onSignIn;

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-fg/35">
        <ProviderStatus state={state} inline />
      </span>
      {canSignIn ? (
        <button
          onClick={() => onSignIn(providerId)}
          className="shrink-0 rounded-md border border-[#C15F3C]/25 bg-[#C15F3C]/10 px-2 py-1 text-[10px] font-semibold text-[#C15F3C]"
        >
          Sign in
        </button>
      ) : null}
    </div>
  );
}

export function ProviderCard({
  providerId,
  density,
  onSignIn,
}: ProviderCardProps): React.ReactElement {
  const {
    state,
    windows,
    models,
    worst,
    plan,
    accountLabel,
    fetchedAt,
    isStale,
    isRefreshing,
    refresh,
  } = useProviderState(providerId);

  const body = ((): React.ReactElement => {
    if (worst === null) {
      return (
        <EmptyState providerId={providerId} state={state} onSignIn={onSignIn} />
      );
    }

    if (density === "line") {
      return (
        <WorstLine
          label={worst.label}
          usedPercent={worst.usedPercent}
          resetsAt={worst.resetsAt}
        />
      );
    }

    // A provider reporting only per-model windows has none of its own, so
    // fall back to the model list rather than rendering an empty card.
    const rows = windows.length > 0 ? windows : models;
    const resetWindow = longestWindow(rows);

    return (
      <>
        {rows.map((window) => (
          <UsageWindowRow key={window.id} window={window} compact />
        ))}
        {density === "full" && windows.length > 0 ? (
          <ModelWindowList windows={models} />
        ) : null}
        {density === "full" && resetWindow ? (
          <Countdown window={resetWindow} />
        ) : null}
      </>
    );
  })();

  return (
    <div className="px-3.5 py-2.5">
      <CardHeading
        providerId={providerId}
        plan={plan}
        isStale={isStale}
        isRefreshing={isRefreshing}
        onRefresh={() => void refresh()}
      />

      {body}

      {density === "full" && accountLabel ? (
        <div className="mt-1.5 flex items-center justify-between text-[9px] text-fg/25">
          <span>{accountLabel}</span>
          <span>{formatAgo(fetchedAt) ?? "never"}</span>
        </div>
      ) : null}
    </div>
  );
}
