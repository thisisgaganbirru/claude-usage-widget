/**
 * The pieces every view uses to render a provider's windows.
 *
 * A window is a label, a percentage and a reset time, so one row component
 * covers Claude's 5h session, its weekly totals, its per-model bars, and
 * whatever the next vendor reports. Adding a provider adds no components here.
 */
import React from "react";
import { formatResetIn, formatPercent } from "@renderer/format";
import type { ProviderState, UsageWindow } from "@shared/usage";

const BAR_HEIGHT = 8;

export function ProgressBar({
  percent,
  trackClass,
  fillClass,
  height = BAR_HEIGHT,
}: {
  percent: number;
  trackClass: string;
  fillClass: string;
  height?: number;
}): React.ReactElement {
  const clamped = Math.min(Math.max(percent, 0), 100);
  // A sliver at 0.4% reads as "started"; a literal 0-width rect reads as empty.
  const width = clamped > 0 ? Math.max(clamped, 1) : 0;
  return (
    <svg
      className="w-full"
      height={height}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect
        className={trackClass}
        x="0"
        y="0"
        width="100"
        height={height}
        rx={height / 2}
      />
      <rect
        className={fillClass}
        x="0"
        y="0"
        width={width}
        height={height}
        rx={height / 2}
      />
    </svg>
  );
}

/**
 * The longest-running window that reports a real reset time, for the views
 * that show a single countdown. The old views assumed that was always a
 * seven-day window and fell back to a fabricated date when it was missing;
 * a provider that reports no reset time now simply gets no countdown.
 */
export function longestWindow(windows: UsageWindow[]): UsageWindow | null {
  let longest: UsageWindow | null = null;
  for (const window of windows) {
    if (window.resetsAt === null) continue;
    if (
      longest === null ||
      (window.windowMinutes ?? 0) > (longest.windowMinutes ?? 0)
    ) {
      longest = window;
    }
  }
  return longest;
}

/** Blue below half, amber, orange, red: the same ramp the tray icon uses. */
export function fillClassFor(percent: number): string {
  if (percent >= 90) return "fill-red-400";
  if (percent >= 75) return "fill-orange-400";
  if (percent >= 50) return "fill-amber-400";
  return "fill-blue-400";
}

export function UsageWindowRow({
  window,
  compact = false,
}: {
  window: UsageWindow;
  compact?: boolean;
}): React.ReactElement {
  const resetsIn = formatResetIn(window.resetsAt);

  return (
    <div className={compact ? "mb-1.5" : "mb-2.5"}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-fg">{window.label}</span>
        <span className="text-[11px] font-medium tabular-nums text-fg/50">
          {formatPercent(window.usedPercent)} used
        </span>
      </div>

      <div className="mb-1.5 text-[10px] text-fg/30">
        {resetsIn === null ? "No reset time reported" : `Resets in ${resetsIn}`}
      </div>

      <ProgressBar
        percent={window.usedPercent}
        trackClass="fill-fg/10"
        fillClass={fillClassFor(window.usedPercent)}
        height={compact ? 6 : BAR_HEIGHT}
      />
    </div>
  );
}

/** The per-model breakdown: thinner bars, no reset line of their own. */
export function ModelWindowList({
  windows,
}: {
  windows: UsageWindow[];
}): React.ReactElement | null {
  if (windows.length === 0) return null;

  return (
    <div className="mt-1.5">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-fg/30">
        By model
      </div>
      {windows.map((window) => (
        <div key={window.id} className="mb-1.5">
          <div className="mb-0.5 flex items-center justify-between">
            <span className="text-[11px] text-fg/70">{window.label}</span>
            <span className="text-[10px] tabular-nums text-fg/40">
              {formatPercent(window.usedPercent)}
            </span>
          </div>
          <ProgressBar
            percent={window.usedPercent}
            trackClass="fill-fg/10"
            fillClass={fillClassFor(window.usedPercent)}
            height={4}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * What a card says when it has no reading. The error branch shows our own
 * phrase for the error kind, never the vendor's message: that string is
 * untrusted, can be arbitrarily long, and is already in the log.
 */
export function ProviderStatus({
  state,
  inline = false,
}: {
  state: ProviderState;
  /** Renders the phrase alone, for a caller that supplies its own layout. */
  inline?: boolean;
}): React.ReactElement {
  const message = ((): string => {
    switch (state.kind) {
      case "not-detected":
        return "Not detected on this machine.";
      case "needs-auth":
        return state.hint;
      case "error":
        switch (state.code) {
          case "rate-limited":
            return "Rate limited. Retrying shortly.";
          case "network":
            return "Could not reach the service. Retrying.";
          case "schema":
            return "The service changed its response. Update needed.";
          default:
            return "Usage is unavailable right now.";
        }
      default:
        return "No usage reported.";
    }
  })();

  if (inline) return <>{message}</>;

  return (
    <div className="px-3.5 py-4 text-center text-[11px] text-fg/40">
      {message}
    </div>
  );
}
