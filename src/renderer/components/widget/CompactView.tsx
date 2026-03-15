import React, { useState, useEffect } from "react";
import { useUsageData } from "@renderer/hooks/useUsageData";
import { WidgetHeader, SizeOption } from "./WidgetHeader";
import { Footer } from "./Footer";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function formatCountdown(resetTime: Date): string {
  const now = new Date();
  const diff = resetTime.getTime() - now.getTime();
  if (diff <= 0) return "0d 00:00:00";
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// ─── StackedBar ───────────────────────────────────────────────────────────────

interface BarSegment {
  name: string;
  used: number; // width as a percentage of the full bar (0-100)
  color: string;
}

function StackedBar({
  segments,
}: {
  segments: BarSegment[];
}): React.ReactElement {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div style={{ position: "relative" }}>
      {/* Tooltip — floats above the hovered segment */}
      {hoveredIdx !== null && (
        <div
          style={{
            position: "absolute",
            top: -28,
            // centre the tooltip over the midpoint of the hovered segment
            left: `${
              segments
                .slice(0, hoveredIdx)
                .reduce((acc, s) => acc + s.used, 0) +
              segments[hoveredIdx].used / 2
            }%`,
            transform: "translateX(-50%)",
            background: "rgba(28,28,31,0.97)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 5,
            padding: "3px 8px",
            fontSize: 11,
            color: segments[hoveredIdx].color,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          {segments[hoveredIdx].name}: {segments[hoveredIdx].used}%
        </div>
      )}

      {/* Bar track */}
      <div
        style={{
          height: 6,
          background: "rgba(255,255,255,0.07)",
          borderRadius: 3,
          overflow: "hidden",
          display: "flex",
        }}
      >
        {segments.map((seg, i) => (
          <div
            key={seg.name}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            style={{
              width: `${seg.used}%`,
              background: seg.color,
              // dim non-hovered segments while one is active
              opacity: hoveredIdx === null || hoveredIdx === i ? 1 : 0.35,
              transition: "opacity 0.15s",
              cursor: "default",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── CompactView ──────────────────────────────────────────────────────────────

export function CompactView({
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
  const [countdown, setCountdown] = useState("0d 00:00:00");
  const [, setTick] = useState(0);

  // Live countdown — recalculate from sevenDayResetTime every second
  useEffect(() => {
    if (!usageData?.sevenDayResetTime) return;
    const update = (): void =>
      setCountdown(formatCountdown(new Date(usageData.sevenDayResetTime)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [usageData?.sevenDayResetTime]);

  // Re-render every 30 s to keep "last updated" fresh
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // ── Loading / null guard ──────────────────────────────────────────────────
  if (!usageData) {
    return (
      <div
        style={{
          background: "#0d0d0d",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "3px solid rgba(255,255,255,0.08)",
            borderTopColor: "#C15F3C",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const pct = Math.min(100, Math.max(0, usageData.sevenDayUsage)); // 7-day %
  const sessionPct = Math.min(100, Math.max(0, usageData.percentageUsed)); // 5-hour %
  // five_hour window: null = not started, ≤5h = active, >5h = error/fallback
  const resetDiff =
    usageData.resetTime != null
      ? new Date(usageData.resetTime).getTime() - Date.now()
      : null;
  const sessionActive = resetDiff !== null && resetDiff <= 5 * 60 * 60 * 1000;
  const sessionError = resetDiff !== null && resetDiff > 5 * 60 * 60 * 1000;
  const opusPct = Math.round(usageData.opusUsage ?? 0);
  const sonnetPct = Math.round(usageData.sonnetUsage ?? 0);
  const haikuPct = Math.max(0, Math.round(pct) - opusPct - sonnetPct); // remainder

  const resetDate = new Date(usageData.sevenDayResetTime);
  const sessionResetDate = usageData.resetTime ? new Date(usageData.resetTime) : null;

  const weeklyDayName = resetDate.toLocaleDateString("en-US", {
    weekday: "short",
  });
  const weeklyTimeStr = resetDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const sessionDayName = sessionResetDate?.toLocaleDateString("en-US", {
    weekday: "short",
  }) ?? "—";
  const sessionTimeStr = sessionResetDate?.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }) ?? "—";

  const models: BarSegment[] = [
    { name: "Opus", used: opusPct, color: "#C15F3C" },
    { name: "Sonnet", used: sonnetPct, color: "#6b9eff" },
    { name: "Haiku", used: haikuPct, color: "#10b981" },
  ];

  const tsForUpdate = lastUpdated ?? usageData.timestamp ?? null;

  // Color-code the weekly % badge by usage level
  const weeklyPctColor =
    pct < 50
      ? "#22c55e"
      : pct < 75
        ? "#f59e0b"
        : pct < 90
          ? "#C15F3C"
          : "#ef4444";

  // ── Palette ───────────────────────────────────────────────────────────────
  const muted = "rgba(255,255,255,0.45)";
  const dimmer = "rgba(255,255,255,0.28)";

  // ── Shared micro-styles ───────────────────────────────────────────────────
  const sectionDivider: React.CSSProperties = {
    height: 1,
    background: "rgba(255,255,255,0.06)",
  };

  return (
    <div style={{ background: "transparent", height: "auto" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Card shell ───────────────────────────────────────────────────── */}
      <div
        data-widget-card
        style={{
          width: 270,
          background: "rgba(24,24,27,0.97)",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow:
            "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
          display: "flex",
          flexDirection: "column",
          // overflow must be visible so the absolute context menu can escape
          overflow: "visible",
        }}
      >
        {/* ── Header ───────────────────────────────────────────────────────── */}
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

        {/* ── Divider ───────────────────────────────────────────────────────── */}
        <div style={sectionDivider} />

        {/* ── Current session ───────────────────────────────────────────────── */}
        <div style={{ padding: "12px 14px 11px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 3,
            }}
          >
            <span style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>
              Current session
            </span>
            <span style={{ color: muted, fontSize: 11 }}>
              {Math.round(sessionPct)}% used
            </span>
          </div>

          {/* Subtitle: static hint only when no real five_hour window, otherwise shows reset time */}
          <div style={{ color: dimmer, fontSize: 11, marginBottom: 8 }}>
            {sessionError
              ? <span style={{ color: "#f87171" }}>Something's off — try restarting the widget</span>
              : !sessionActive
              ? "Starts when a message is sent"
              : `Resets in ${formatSessionReset(new Date(usageData.resetTime!))}`}
          </div>

          {/* Thin blue session bar */}
          <div
            style={{
              height: 5,
              background: "rgba(255,255,255,0.07)",
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${sessionPct}%`,
                height: "100%",
                background: "#6b9eff",
                borderRadius: 3,
                transition: "width 0.3s",
              }}
            />
          </div>
        </div>

        {/* ── Divider ───────────────────────────────────────────────────────── */}
        <div style={sectionDivider} />

        {/* ── Weekly limits ─────────────────────────────────────────────────── */}
        <div style={{ padding: "12px 14px 11px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 3,
            }}
          >
            <span style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>
              Weekly limits
            </span>
            {/* Color-coded percentage */}
            <span
              style={{ color: weeklyPctColor, fontSize: 11, fontWeight: 600 }}
            >
              {Math.round(pct)}% used
            </span>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 9,
            }}
          >
            <span style={{ color: dimmer, fontSize: 11 }}>All models</span>
            <span style={{ color: dimmer, fontSize: 11 }}>
              Resets {weeklyDayName} {weeklyTimeStr}
            </span>
          </div>

          {/* Interactive stacked bar */}
          <div style={{ marginBottom: 9 }}>
            <StackedBar segments={models} />
          </div>

          {/* Model legend */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {models.map(({ name, used, color }) => (
              <div
                key={name}
                style={{ display: "flex", alignItems: "center", gap: 5 }}
              >
                <div
                  style={{
                    width: 7,
                    height: 7,
                    background: color,
                    borderRadius: 2,
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: muted, fontSize: 11 }}>
                  {name} {used}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Reset countdown card ──────────────────────────────────────────── */}
        <div style={{ padding: "2px 14px 12px" }}>
          <div
            style={{
              background: "rgba(255,255,255,0.03)",
              borderRadius: 10,
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ color: muted, fontSize: 11, fontWeight: 500 }}>
              Resets in
            </span>
            <span
              style={{
                color: "#C15F3C",
                letterSpacing: "0.03em",
              }}
            >
              {countdown}
            </span>
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <Footer
          lastUpdated={tsForUpdate ? new Date(tsForUpdate) : null}
          label={usageData.userName}
          onRefresh={() =>
            (window as any).electron?.ipcRenderer?.invoke("poller:start")
          }
        />
      </div>
    </div>
  );
}
