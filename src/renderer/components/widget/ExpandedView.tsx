import React, { useState, useEffect } from "react";
import { useUsageData } from "@renderer/hooks/useUsageData";
import { WidgetHeader, SizeOption } from "./WidgetHeader";
import { Footer } from "./Footer";

// ─── Helper functions (unchanged) ────────────────────────────────────────────

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0d 00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${days}d ${hh}:${mm}:${ss}`;
}

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

function formatResetDate(date: Date): string {
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatResetDay(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function formatResetTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── ProgressBar — defined outside so it has no closure over component state ─

const ProgressBar = ({
  percent,
  color = "#6b9eff",
  height = 6,
}: {
  percent: number;
  color?: string;
  height?: number;
}) => (
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
        width: `${Math.max(percent, 1)}%`,
        background: color,
        borderRadius: height / 2,
        transition: "width 0.5s ease",
      }}
    />
  </div>
);

// ─── ExpandedView ─────────────────────────────────────────────────────────────

export function ExpandedView({
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
}) {
  const { usageData, isLoading, lastUpdated } = useUsageData();
  const [countdown, setCountdown] = useState("0d 00:00:00");
  const [, setTick] = useState(0);

  // New UI state
  const [hoveredModel, setHoveredModel] = useState<number | null>(null);

  // Tick every second to keep countdown fresh; recalculate from resetTime, never subtract
  useEffect(() => {
    const timer = setInterval(() => {
      if (usageData?.sevenDayResetTime) {
        const ms = new Date(usageData.sevenDayResetTime).getTime() - Date.now();
        setCountdown(formatCountdown(ms));
      }
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [usageData?.sevenDayResetTime]);

  // Seed countdown immediately when data arrives
  useEffect(() => {
    if (usageData?.sevenDayResetTime) {
      const ms = new Date(usageData.sevenDayResetTime).getTime() - Date.now();
      setCountdown(formatCountdown(ms));
    }
  }, [usageData?.sevenDayResetTime]);

  // ── Loading / null guard ───────────────────────────────────────────────────
  if (isLoading || !usageData) {
    return (
      <div
        style={{
          background: "transparent",
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
            border: "3px solid rgba(255,255,255,0.1)",
            borderTop: "3px solid #C15F3C",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Data derivations (unchanged) ──────────────────────────────────────────
  const pct = Math.round(Math.min(Math.max(usageData.sevenDayUsage, 0), 100));
  const sessionPct = Math.round(
    Math.min(Math.max(usageData.percentageUsed, 0), 100),
  );
  const opusPct = Math.round(usageData.opusUsage ?? 0);
  const sonnetPct = Math.round(usageData.sonnetUsage ?? 0);
  const haikuPct = Math.max(0, pct - opusPct - sonnetPct);
  const resetDate = new Date(usageData.sevenDayResetTime);
  const sessionResetDate = new Date(usageData.resetTime);
  const sessionActive =
    sessionResetDate.getTime() - Date.now() <= 5 * 60 * 60 * 1000;

  // Models array — uses derived per-model values and new design colours
  const models = [
    { name: "Opus 4.6", used: opusPct, color: "#C15F3C" },
    { name: "Sonnet 4.5", used: sonnetPct, color: "#6b9eff" },
    { name: "Haiku 4.5", used: haikuPct, color: "#10b981" },
  ];

  // ── Sub-components (defined inside to close over hoveredModel / state) ─────

  /** Stacked bar — each segment dims when another segment is hovered */
  const StackedBar = ({
    models: m,
    height = 6,
  }: {
    models: typeof models;
    height?: number;
  }) => {
    let accumulated = 0;
    return (
      <div
        style={{
          position: "relative",
          height,
          background: "rgba(255,255,255,0.08)",
          borderRadius: height / 2,
          overflow: "hidden",
          width: "100%",
        }}
      >
        {m.map((model, i) => {
          const w = model.used;
          const left = accumulated;
          accumulated += model.used;
          return (
            <div
              key={i}
              onMouseEnter={() => setHoveredModel(i)}
              onMouseLeave={() => setHoveredModel(null)}
              style={{
                position: "absolute",
                left: `${left}%`,
                width: `${w}%`,
                height: "100%",
                background: model.color,
                // Dim non-hovered segments for focus effect
                opacity: hoveredModel !== null && hoveredModel !== i ? 0.4 : 1,
                transition: "opacity 0.2s ease",
                borderRight:
                  i < m.length - 1 && w > 0
                    ? "1px solid rgba(0,0,0,0.3)"
                    : "none",
                cursor: "pointer",
              }}
            />
          );
        })}
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        background: "transparent",
        height: "auto",
        overflowY: "visible",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      }}
    >
      {/* Relative wrapper lets the absolute context menu position against it */}
      <div style={{ position: "relative" }}>
        <div
          data-widget-card
          style={{
            background: "rgba(24, 24, 27, 0.97)",
            backdropFilter: "blur(24px)",
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.06)",
            boxShadow:
              "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            overflow: "visible",
          }}
        >
          {/* ── Header ──────────────────────────────────────────────────────── */}
          <div style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
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
          </div>

          {/* ── Body ────────────────────────────────────────────────────────── */}
          <div style={{ padding: "16px 18px" }}>
            {/* Current Session */}
            <div style={{ marginBottom: 18 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>
                  Current session
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,0.5)",
                    fontWeight: 500,
                  }}
                >
                  {sessionPct}% used
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.3)",
                  marginBottom: 8,
                }}
              >
                {!sessionActive
                  ? "Starts when a message is sent"
                  : `Resets in ${formatSessionReset(sessionResetDate)}`}
              </div>
              <ProgressBar percent={sessionPct} color="#6b9eff" height={6} />
            </div>

            {/* Full-width divider */}
            <div
              style={{
                height: 1,
                background: "rgba(255,255,255,0.06)",
                margin: "0 -18px 16px",
                width: "calc(100% + 36px)",
              }}
            />

            {/* Weekly Limits — header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 4,
              }}
            >
              <span style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>
                Weekly limits
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.5)",
                  fontWeight: 500,
                }}
              >
                {pct}% used
              </span>
            </div>

            {/* All Models stacked bar */}
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.5)",
                    fontWeight: 600,
                  }}
                >
                  All models
                </span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                  Resets {formatResetDay(resetDate)}{" "}
                  {formatResetTime(resetDate)}
                </span>
              </div>
              <StackedBar models={models} height={7} />
            </div>

            {/* Per-model breakdown */}
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                borderRadius: 10,
                padding: "12px 12px 10px",
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "rgba(255,255,255,0.3)",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  marginBottom: 10,
                }}
              >
                PER-MODEL BREAKDOWN
              </div>
              {models.map((model, i) => (
                <div
                  key={i}
                  onMouseEnter={() => setHoveredModel(i)}
                  onMouseLeave={() => setHoveredModel(null)}
                  style={{
                    marginBottom: i < models.length - 1 ? 12 : 0,
                    cursor: "pointer",
                    // Dim rows that aren't currently hovered
                    opacity:
                      hoveredModel !== null && hoveredModel !== i ? 0.5 : 1,
                    transition: "opacity 0.2s",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 5,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                      }}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: model.color,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.7)",
                          fontWeight: 600,
                        }}
                      >
                        {model.name}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        color: "rgba(255,255,255,0.4)",
                        fontWeight: 500,
                      }}
                    >
                      {model.used}% used
                    </span>
                  </div>
                  <ProgressBar
                    percent={model.used}
                    color={model.color}
                    height={4}
                  />
                </div>
              ))}
            </div>

            {/* Weekly reset countdown */}
            <div
              style={{
                background: "rgba(193, 95, 60, 0.06)",
                border: "1px solid rgba(193, 95, 60, 0.1)",
                borderRadius: 10,
                padding: "10px 12px",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.35)",
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                  }}
                >
                  WEEKLY RESET IN
                </span>
                {/* Monospace countdown so digits don't jitter */}
                <span
                  style={{
                    fontSize: 16,
                    color: "#C15F3C",
                  }}
                >
                  {countdown}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                  Next reset
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.45)",
                    fontWeight: 500,
                  }}
                >
                  {formatResetDate(resetDate)}
                </span>
              </div>
            </div>

            {/* Alert thresholds */}
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                borderRadius: 10,
                padding: "10px 12px",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "rgba(255,255,255,0.3)",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  marginBottom: 8,
                }}
              >
                ALERT THRESHOLDS
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { pct: 50, active: false },
                  { pct: 75, active: true },
                  { pct: 90, active: true },
                ].map((t, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      padding: "5px 0",
                      borderRadius: 6,
                      border: `1px solid ${t.active ? "rgba(193,95,60,0.25)" : "rgba(255,255,255,0.06)"}`,
                      background: t.active
                        ? "rgba(193,95,60,0.06)"
                        : "transparent",
                      textAlign: "center",
                      fontSize: 10,
                      color: t.active ? "#C15F3C" : "rgba(255,255,255,0.25)",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t.pct}%
                  </div>
                ))}
              </div>
            </div>

            {/* Quick actions */}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() =>
                  (window as any).electron?.ipcRenderer?.invoke(
                    "app:openExternal",
                    "https://claude.ai",
                  )
                }
                style={{
                  flex: 1,
                  padding: "9px 0",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  color: "rgba(255,255,255,0.6)",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                }}
              >
                <span style={{ fontSize: 13 }}>↗</span> Open Claude
              </button>
              <button
                onClick={() =>
                  (window as any).electron?.ipcRenderer?.invoke(
                    "app:openExternal",
                    "https://claude.ai/settings/general",
                  )
                }
                style={{
                  flex: 1,
                  padding: "9px 0",
                  borderRadius: 8,
                  border: "1px solid rgba(193,95,60,0.2)",
                  background: "rgba(193,95,60,0.06)",
                  color: "#C15F3C",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                }}
              >
                <span style={{ fontSize: 11 }}>⚙</span> Settings
              </button>
            </div>
          </div>

          {/* ── Footer ──────────────────────────────────────────────────────── */}
          <Footer
            lastUpdated={lastUpdated ? new Date(lastUpdated) : null}
            label={usageData.userName}
            onRefresh={() =>
              (window as any).electron?.ipcRenderer?.invoke("poller:start")
            }
          />
        </div>
      </div>
    </div>
  );
}
