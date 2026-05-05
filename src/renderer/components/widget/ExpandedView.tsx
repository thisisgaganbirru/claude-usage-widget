import React, { useState, useEffect } from "react";
import { useUsageData } from "@renderer/hooks/useUsageData";
import { WidgetHeader, SizeOption } from "./WidgetHeader";
import { Footer } from "./Footer";
import { ProviderType } from "@shared/types";

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

function ProgressBar({
  percent,
  color,
  height = 6,
}: {
  percent: number;
  color: string;
  height?: number;
}): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, percent));
  const width = clamped > 0 ? Math.max(clamped, 1) : 0;
  return (
    <svg
      className="w-full"
      height={height}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="100" height={height} rx={height / 2} className="fill-white/10" />
      <rect x="0" y="0" width={width} height={height} rx={height / 2} fill={color} />
    </svg>
  );
}

function StackedBar({
  opus,
  sonnet,
  haiku,
}: {
  opus: number;
  sonnet: number;
  haiku: number;
}): React.ReactElement {
  const o = Math.max(0, Math.min(100, opus));
  const s = Math.max(0, Math.min(100 - o, sonnet));
  const h = Math.max(0, Math.min(100 - o - s, haiku));
  return (
    <svg
      className="w-full"
      height={7}
      viewBox="0 0 100 7"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="100" height="7" rx="3.5" className="fill-white/10" />
      <rect x="0" y="0" width={o} height="7" rx="3.5" fill="#C15F3C" />
      <rect x={o} y="0" width={s} height="7" fill="#6b9eff" />
      <rect x={o + s} y="0" width={h} height="7" rx="3.5" fill="#10b981" />
    </svg>
  );
}

export function ExpandedView({
  provider,
  onProviderChange,
  selectedSize,
  onSizeChange,
  isPinned,
  onTogglePin,
  onLogout,
  onRemove,
}: {
  provider: ProviderType;
  onProviderChange: (provider: ProviderType) => void;
  selectedSize: SizeOption;
  onSizeChange: (s: SizeOption) => void;
  isPinned?: boolean;
  onTogglePin?: (pinned: boolean) => void;
  onLogout?: () => void;
  onRemove?: () => void;
}): React.ReactElement {
  const { usageData, isLoading, lastUpdated } = useUsageData(provider);
  const [countdown, setCountdown] = useState("0d 00:00:00");
  const [hoveredModel, setHoveredModel] = useState<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      if (usageData?.sevenDayResetTime) {
        const ms = new Date(usageData.sevenDayResetTime).getTime() - Date.now();
        setCountdown(formatCountdown(ms));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [usageData?.sevenDayResetTime]);

  useEffect(() => {
    if (usageData?.sevenDayResetTime) {
      const ms = new Date(usageData.sevenDayResetTime).getTime() - Date.now();
      setCountdown(formatCountdown(ms));
    }
  }, [usageData?.sevenDayResetTime]);

  if (isLoading || !usageData) {
    return (
      <div className="flex h-full items-center justify-center bg-transparent">
        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-white/10 border-t-[#C15F3C]" />
      </div>
    );
  }

  const pct = Math.round(Math.min(Math.max(usageData.sevenDayUsage, 0), 100));
  const sessionPct = Math.round(
    Math.min(Math.max(usageData.percentageUsed, 0), 100),
  );
  const opusPct = Math.round(usageData.opusUsage ?? 0);
  const sonnetPct = Math.round(usageData.sonnetUsage ?? 0);
  const haikuPct = Math.max(0, pct - opusPct - sonnetPct);
  const resetDate = new Date(usageData.sevenDayResetTime);
  const sessionResetDate = usageData.resetTime
    ? new Date(usageData.resetTime)
    : null;
  const sessionActive =
    sessionResetDate !== null &&
    sessionResetDate.getTime() - Date.now() <= 5 * 60 * 60 * 1000;

  const models =
    provider === "chatgpt"
      ? [
          {
            name: "GPT-5",
            used: opusPct,
            color: "#C15F3C",
            dotClass: "bg-[#C15F3C]",
          },
          {
            name: "GPT-4.1",
            used: sonnetPct,
            color: "#6b9eff",
            dotClass: "bg-[#6b9eff]",
          },
          {
            name: "Other",
            used: haikuPct,
            color: "#10b981",
            dotClass: "bg-emerald-500",
          },
        ]
      : [
          {
            name: "Opus 4.6",
            used: opusPct,
            color: "#C15F3C",
            dotClass: "bg-[#C15F3C]",
          },
          {
            name: "Sonnet 4.5",
            used: sonnetPct,
            color: "#6b9eff",
            dotClass: "bg-[#6b9eff]",
          },
          {
            name: "Haiku 4.5",
            used: haikuPct,
            color: "#10b981",
            dotClass: "bg-emerald-500",
          },
        ];

  return (
    <div className="h-auto overflow-y-visible bg-transparent">
      <div className="relative">
        <div
          data-widget-card
          className="overflow-visible rounded-[18px] border border-white/10 bg-[rgba(24,24,27,0.97)] shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-2xl"
        >
          <div className="border-b border-white/5">
            <WidgetHeader
              provider={provider}
              onProviderChange={onProviderChange}
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

          <div className="px-[18px] pb-4 pt-4">
            <div className="mb-[18px]">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-white">
                  Current session
                </span>
                <span className="text-xs font-medium text-white/50">
                  {sessionPct}% used
                </span>
              </div>
              <div className="mb-2 text-[11px] text-white/30">
                {!sessionActive
                  ? "Starts when a message is sent"
                  : `Resets in ${formatSessionReset(sessionResetDate!)}`}
              </div>
              <ProgressBar percent={sessionPct} color="#6b9eff" height={6} />
            </div>

            <div className="-mx-[18px] mb-4 h-px bg-white/10" />

            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[13px] font-semibold text-white">Weekly limits</span>
              <span className="text-xs font-medium text-white/50">{pct}% used</span>
            </div>

            <div className="mb-[14px]">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-white/50">All models</span>
                <span className="text-[10px] text-white/30">
                  Resets {formatResetDay(resetDate)} {formatResetTime(resetDate)}
                </span>
              </div>
              <StackedBar opus={opusPct} sonnet={sonnetPct} haiku={haikuPct} />
            </div>

            <div className="mb-[14px] rounded-[10px] bg-white/5 px-3 py-3">
              <div className="mb-2.5 text-[9px] font-semibold tracking-[0.06em] text-white/30">
                PER-MODEL BREAKDOWN
              </div>
              {models.map((model, i) => (
                <div
                  key={model.name}
                  onMouseEnter={() => setHoveredModel(i)}
                  onMouseLeave={() => setHoveredModel(null)}
                  className={`cursor-pointer transition-opacity ${
                    i < models.length - 1 ? "mb-3" : ""
                  } ${
                    hoveredModel !== null && hoveredModel !== i
                      ? "opacity-50"
                      : "opacity-100"
                  }`}
                >
                  <div className="mb-[5px] flex items-center justify-between">
                    <div className="flex items-center gap-[7px]">
                      <div className={`h-2 w-2 rounded-[2px] ${model.dotClass}`} />
                      <span className="text-[11px] font-semibold text-white/70">
                        {model.name}
                      </span>
                    </div>
                    <span className="text-[11px] font-medium text-white/40">
                      {model.used}% used
                    </span>
                  </div>
                  <ProgressBar percent={model.used} color={model.color} height={4} />
                </div>
              ))}
            </div>

            <div className="mb-3 rounded-[10px] border border-[#C15F3C]/10 bg-[#C15F3C]/10 px-3 py-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold tracking-[0.04em] text-white/35">
                  WEEKLY RESET IN
                </span>
                <span className="text-base text-[#C15F3C]">{countdown}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/25">Next reset</span>
                <span className="text-[11px] font-medium text-white/45">
                  {formatResetDate(resetDate)}
                </span>
              </div>
            </div>

            <div className="mb-3 rounded-[10px] bg-white/5 px-3 py-2.5">
              <div className="mb-2 text-[9px] font-semibold tracking-[0.06em] text-white/30">
                ALERT THRESHOLDS
              </div>
              <div className="flex gap-1.5">
                {[
                  { pct: 50, active: false },
                  { pct: 75, active: true },
                  { pct: 90, active: true },
                ].map((t) => (
                  <div
                    key={t.pct}
                    className={`flex-1 rounded-md border py-[5px] text-center text-[10px] font-semibold ${
                      t.active
                        ? "border-[#C15F3C]/25 bg-[#C15F3C]/10 text-[#C15F3C]"
                        : "border-white/10 text-white/25"
                    }`}
                  >
                    {t.pct}%
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-1.5">
              <button
                onClick={() =>
                  (window as any).electron?.ipcRenderer?.invoke(
                    "app:openExternal",
                    provider === "chatgpt" ? "https://chatgpt.com/" : "https://claude.ai",
                  )
                }
                className="flex flex-1 items-center justify-center gap-[5px] rounded-lg border border-white/10 bg-white/5 py-[9px] text-[11px] font-semibold text-white/60"
              >
                  <span className="text-[13px]">↗</span>{" "}
                  {provider === "chatgpt" ? "Open ChatGPT" : "Open Claude"}
              </button>
              <button
                onClick={() =>
                  (window as any).electron?.ipcRenderer?.invoke(
                    "app:openExternal",
                    provider === "chatgpt"
                      ? "https://chatgpt.com/"
                      : "https://claude.ai/settings/general",
                  )
                }
                className="flex flex-1 items-center justify-center gap-[5px] rounded-lg border border-[#C15F3C]/20 bg-[#C15F3C]/10 py-[9px] text-[11px] font-semibold text-[#C15F3C]"
              >
                <span className="text-[11px]">⚙</span>{" "}
                {provider === "chatgpt" ? "Workspace" : "Settings"}
              </button>
            </div>
          </div>

          <Footer
            provider={provider}
            lastUpdated={lastUpdated ? new Date(lastUpdated) : null}
            label={usageData.userName}
            onRefresh={() =>
              (window as any).electron?.ipcRenderer?.invoke("poller:start", provider)
            }
          />
        </div>
      </div>
    </div>
  );
}
