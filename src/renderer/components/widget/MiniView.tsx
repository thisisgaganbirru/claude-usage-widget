import React, { useState, useEffect } from "react";
import { useUsageData } from "@renderer/hooks/useUsageData";
import { WidgetHeader, SizeOption } from "./WidgetHeader";
import { Footer } from "./Footer";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Recalculate countdown from the raw reset Date — never subtract from stored value */
function formatCountdown(resetTime: Date): string {
  const diff = resetTime.getTime() - Date.now();
  if (diff <= 0) return "0d 00:00:00";
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days}d ${p(hours)}:${p(minutes)}:${p(seconds)}`;
}

/** "4 hr 2 min" or "45 min" — used for 5-hour session reset */
function formatSessionReset(resetTime: Date): string {
  const diff = resetTime.getTime() - Date.now();
  if (diff <= 0) return "now";
  const totalMin = Math.floor(diff / 60000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours > 0 && minutes > 0) return `${hours} hr ${minutes} min`;
  if (hours > 0) return `${hours} hr`;
  return `${minutes} min`;
}

/** "Mon 9:30 AM" — used beside the "Resets" label in the weekly section */
function formatResetLabel(d: Date): string {
  const day = d.toLocaleDateString("en-US", { weekday: "short" });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} ${time}`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface ProgressBarProps {
  percent: number;
  color?: string;
  height?: number;
}

function ProgressBar({
  percent,
  color = "#6b9eff",
  height = 6,
}: ProgressBarProps): React.ReactElement {
  return (
    <div
      style={{
        height,
        background: "rgba(255,255,255,0.08)",
        borderRadius: height / 2,
        overflow: "hidden",
        width: "100%",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.max(percent, percent > 0 ? 1 : 0)}%`,
          background: color,
          borderRadius: height / 2,
          transition: "width 0.5s ease",
        }}
      />
    </div>
  );
}

interface Segment {
  key: string;
  color: string;
  /** Proportional weight inside the filled region — not the raw % of the total bar */
  weight: number;
}

interface StackedBarProps {
  segments: Segment[];
  totalPct: number;
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
  height?: number;
}

/** Fills `totalPct`% of the track then splits that region proportionally by segment weight */
function StackedBar({
  segments,
  totalPct,
  hoveredKey,
  onHover,
  height = 6,
}: StackedBarProps): React.ReactElement {
  const clampedTotal = Math.min(Math.max(totalPct, 0), 100);
  const totalWeight = segments.reduce((sum, seg) => sum + seg.weight, 0);

  return (
    <div
      style={{
        height,
        background: "rgba(255,255,255,0.08)",
        borderRadius: height / 2,
        overflow: "hidden",
        width: "100%",
      }}
    >
      <div
        style={{
          width: `${Math.max(clampedTotal, clampedTotal > 0 ? 1 : 0)}%`,
          height: "100%",
          display: "flex",
        }}
      >
        {segments.map((seg) => (
          <div
            key={seg.key}
            onMouseEnter={() => onHover(seg.key)}
            onMouseLeave={() => onHover(null)}
            style={{
              flex: totalWeight > 0 ? seg.weight / totalWeight : 1,
              background: seg.color,
              height: "100%",
              opacity: hoveredKey === null || hoveredKey === seg.key ? 1 : 0.4,
              transition: "opacity 0.2s ease",
              cursor: "default",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MiniView({
  selectedSize,
  onSizeChange,
  isPinned,
  onTogglePin,
  onLogout,
  onRemove,
}: {
  selectedSize: SizeOption;
  onSizeChange: (s: SizeOption) => void;
  isPinned?: boolean;
  onTogglePin?: (pinned: boolean) => void;
  onLogout?: () => void;
  onRemove?: () => void;
}): React.ReactElement {
  const { usageData, isLoading, lastUpdated } = useUsageData();
  const [countdown, setCountdown] = useState<string>("0d 00:00:00");
  const [hoveredModel, setHoveredModel] = useState<string | null>(null);

  // Live countdown — recalculated from sevenDayResetTime every second
  useEffect(() => {
    if (!usageData?.sevenDayResetTime) return;
    const target = new Date(usageData.sevenDayResetTime);
    const tick = () => setCountdown(formatCountdown(target));
    tick(); // fire immediately so there is no 1-second blank
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [usageData?.sevenDayResetTime]);

  // ── Loading / null guard ──────────────────────────────────────────────────
  if (isLoading || !usageData) {
    return (
      <div
        style={{
          backgroundColor: "transparent",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "3px solid #2a2a2a",
            borderTopColor: "#6366f1",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const sessionPct = Math.min(100, Math.max(0, usageData.percentageUsed));
  const weeklyPct = Math.min(100, Math.max(0, usageData.sevenDayUsage));
  // three states: null = not started, ≤5h = active, >5h = API fallback/error
  const resetDiff =
    usageData.resetTime != null
      ? new Date(usageData.resetTime).getTime() - Date.now()
      : null;
  const sessionActive = resetDiff !== null && resetDiff <= 5 * 60 * 60 * 1000;
  const sessionError = resetDiff !== null && resetDiff > 5 * 60 * 60 * 1000;

  const opusPct = Math.round(usageData.opusUsage ?? 0);
  const sonnetPct = Math.round(usageData.sonnetUsage ?? 0);
  // Haiku = remainder of weekly usage after Opus + Sonnet, clamped ≥ 0
  const haikuPct = Math.max(0, Math.round(weeklyPct) - opusPct - sonnetPct);

  const weeklyResetLabel = formatResetLabel(
    new Date(usageData.sevenDayResetTime),
  );

  const barSegments: Segment[] = [
    { key: "opus", color: "#C15F3C", weight: opusPct },
    { key: "sonnet", color: "#6b9eff", weight: sonnetPct },
    { key: "haiku", color: "#10b981", weight: haikuPct },
  ];

  const modelLegend = [
    { key: "opus", label: "Opus", color: "#C15F3C", pct: opusPct },
    { key: "sonnet", label: "Sonnet", color: "#6b9eff", pct: sonnetPct },
    { key: "haiku", label: "Haiku", color: "#10b981", pct: haikuPct },
  ];

  // ── Style constants ───────────────────────────────────────────────────────
  const font =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
  const cardBg = "rgba(24, 24, 27, 0.97)";
  const cardBorder = "1px solid rgba(255,255,255,0.06)";
  const divider: React.CSSProperties = {
    height: 1,
    background: "rgba(255,255,255,0.06)",
    margin: 0,
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const ipc = (window as any).electron?.ipcRenderer;
  return (
    <div
      style={{
        backgroundColor: "transparent",
        padding: "8px",
        boxSizing: "border-box",
        fontFamily: font,
      }}
    >
      {/* ── Single card — header + content ── */}
      <div
        data-widget-card
        style={{
          background: cardBg,
          border: cardBorder,
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <WidgetHeader
          planType={usageData.planType}
          userName={usageData.userName}
          selectedSize={selectedSize}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          onSizeChange={onSizeChange}
          onLogout={onLogout}
          onRemove={onRemove}
        />

        <div style={divider} />

        <div style={{ padding: "8px 14px 14px" }}>
          {/* ── Current session section ── */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 12, color: "#fff", fontWeight: 600 }}>
              Current session
            </span>
            <span
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.5)",
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {Math.round(sessionPct)}% used
            </span>
          </div>

          {sessionError ? (
            <div
              style={{
                fontSize: 10,
                color: "#f87171",
                marginBottom: 6,
              }}
            >
              Something's off — try restarting the widget
            </div>
          ) : !sessionActive ? (
            <div
              style={{
                fontSize: 10,
                color: "rgba(255,255,255,0.3)",
                marginBottom: 6,
              }}
            >
              Starts when a message is sent
            </div>
          ) : (
            <div
              style={{
                fontSize: 10,
                color: "rgba(255,255,255,0.3)",
                marginBottom: 6,
              }}
            >
              Resets in {formatSessionReset(new Date(usageData.resetTime))}
            </div>
          )}

          <ProgressBar percent={sessionPct} color="#6b9eff" height={8} />

          <div style={{ ...divider, margin: "6px -14px" }} />

          {/* ── Last updated ── */}
          <Footer
            lastUpdated={lastUpdated ?? usageData.timestamp ?? null}
            label={usageData.userName}
            onRefresh={() =>
              (window as any).electron?.ipcRenderer?.invoke("poller:start")
            }
            padding="2px 0"
            borderTop="none"
            labelGap={2}
          />
        </div>
      </div>
    </div>
  );
}
