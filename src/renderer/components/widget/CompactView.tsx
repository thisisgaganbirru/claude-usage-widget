import React, { useState, useEffect } from "react";
import { useUsageData } from "@renderer/hooks/useUsageData";
import { WidgetHeader, SizeOption } from "./WidgetHeader";
import { Footer } from "./Footer";
import { AlertBanner } from "./AlertBanner";

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
  const diff = resetTime.getTime() - Date.now();
  if (diff <= 0) return "0d 00:00:00";
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function ProgressBar({
  percent,
  fillClass,
  height = 6,
}: {
  percent: number;
  fillClass: string;
  height?: number;
}): React.ReactElement {
  const clamped = Math.min(Math.max(percent, 0), 100);
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
      <rect x="0" y="0" width={width} height={height} rx={height / 2} className={fillClass} />
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
      height={6}
      viewBox="0 0 100 6"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="100" height="6" rx="3" className="fill-white/10" />
      <rect x="0" y="0" width={o} height="6" rx="3" fill="#C15F3C" />
      <rect x={o} y="0" width={s} height="6" fill="#6b9eff" />
      <rect x={o + s} y="0" width={h} height="6" rx="3" fill="#10b981" />
    </svg>
  );
}

export function CompactView({
  selectedSize,
  onSizeChange,
  isPinned,
  onTogglePin,
  onLogout,
  onHardLogout,
  onRemove,
  alertMessage,
  onAlertIgnore,
  onAlertHoverStart,
  onAlertHoverEnd,
}: {
  selectedSize: SizeOption;
  onSizeChange: (s: SizeOption) => void;
  isPinned?: boolean;
  onTogglePin?: (pinned: boolean) => void;
  onLogout?: () => void;
  onHardLogout?: () => void;
  onRemove?: () => void;
  alertMessage?: string | null;
  onAlertIgnore?: () => void;
  onAlertHoverStart?: () => void;
  onAlertHoverEnd?: () => void;
}): React.ReactElement {
  const { usageData, lastUpdated } = useUsageData();
  const [countdown, setCountdown] = useState("0d 00:00:00");

  useEffect(() => {
    if (!usageData?.sevenDayResetTime) return;
    const update = () =>
      setCountdown(formatCountdown(new Date(usageData.sevenDayResetTime)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [usageData?.sevenDayResetTime]);

  if (!usageData) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0d0d0d]">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/10 border-t-[#C15F3C]" />
      </div>
    );
  }

  const pct = Math.min(100, Math.max(0, usageData.sevenDayUsage));
  const sessionPct = Math.min(100, Math.max(0, usageData.percentageUsed));
  const resetDiff =
    usageData.resetTime != null
      ? new Date(usageData.resetTime).getTime() - Date.now()
      : null;
  const sessionActive = resetDiff !== null && resetDiff <= 5 * 60 * 60 * 1000;
  const sessionError = resetDiff !== null && resetDiff > 5 * 60 * 60 * 1000;
  const opusPct = Math.round(usageData.opusUsage ?? 0);
  const sonnetPct = Math.round(usageData.sonnetUsage ?? 0);
  const haikuPct = Math.max(0, Math.round(pct) - opusPct - sonnetPct);
  const resetDate = new Date(usageData.sevenDayResetTime);
  const weeklyDayName = resetDate.toLocaleDateString("en-US", {
    weekday: "short",
  });
  const weeklyTimeStr = resetDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const weeklyPctClass =
    pct < 50
      ? "text-green-500"
      : pct < 75
        ? "text-amber-500"
        : pct < 90
          ? "text-[#C15F3C]"
          : "text-red-500";

  const models = [
    { name: "Opus", used: opusPct, dotClass: "bg-[#C15F3C]" },
    { name: "Sonnet", used: sonnetPct, dotClass: "bg-[#6b9eff]" },
    { name: "Haiku", used: haikuPct, dotClass: "bg-emerald-500" },
  ];

  return (
    <div className="h-auto bg-transparent p-2">
      <div
        data-widget-card
        className="flex w-full flex-col overflow-visible rounded-2xl border border-white/10 bg-[rgba(24,24,27,0.97)] shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.04)]"
        onMouseEnter={onAlertHoverStart}
        onMouseLeave={onAlertHoverEnd}
      >
        {alertMessage ? (
          <AlertBanner
            message={alertMessage}
            className="rounded-t-2xl"
            onIgnore={onAlertIgnore}
          />
        ) : null}
        <WidgetHeader
          planType={usageData.planType}
          userName={usageData.userName}
          selectedSize={selectedSize}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          onSizeChange={onSizeChange}
          onLogout={onLogout}
          onHardLogout={onHardLogout}
          onRemove={onRemove}
        />

        <div className="h-px bg-white/10" />

        <div className="px-3.5 pb-[11px] pt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-white">Current session</span>
            <span className="text-[11px] text-white/45">
              {Math.round(sessionPct)}% used
            </span>
          </div>

          <div className="mb-2 text-[11px] text-white/30">
            {sessionError ? (
              <span className="text-red-400">Something&apos;s off — try restarting the widget</span>
            ) : !sessionActive ? (
              "Starts when a message is sent"
            ) : (
              `Resets in ${formatSessionReset(new Date(usageData.resetTime!))}`
            )}
          </div>

          <ProgressBar percent={sessionPct} fillClass="fill-[#6b9eff]" height={5} />
        </div>

        <div className="h-px bg-white/10" />

        <div className="px-3.5 pb-[11px] pt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-white">Weekly limits</span>
            <span className={`text-[11px] font-semibold ${weeklyPctClass}`}>
              {Math.round(pct)}% used
            </span>
          </div>

          <div className="mb-[9px] flex items-center justify-between text-[11px] text-white/30">
            <span>All models</span>
            <span>
              Resets {weeklyDayName} {weeklyTimeStr}
            </span>
          </div>

          <div className="mb-[9px]">
            <StackedBar opus={opusPct} sonnet={sonnetPct} haiku={haikuPct} />
          </div>

          <div className="flex flex-wrap gap-2.5">
            {models.map(({ name, used, dotClass }) => (
              <div key={name} className="flex items-center gap-1.5">
                <div className={`h-[7px] w-[7px] shrink-0 rounded-[2px] ${dotClass}`} />
                <span className="text-[11px] text-white/45">
                  {name} {used}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="px-3.5 pb-3 pt-0.5">
          <div className="flex items-center justify-between rounded-[10px] bg-white/5 px-3.5 py-2.5">
            <span className="text-[11px] font-medium text-white/45">Resets in</span>
            <span className="tracking-[0.03em] text-[#C15F3C]">{countdown}</span>
          </div>
        </div>

        <Footer
          lastUpdated={lastUpdated ? new Date(lastUpdated) : null}
          label={usageData.userName}
          onRefresh={() =>
            (window as any).electron?.ipcRenderer?.invoke("poller:start")
          }
        />
      </div>
    </div>
  );
}
