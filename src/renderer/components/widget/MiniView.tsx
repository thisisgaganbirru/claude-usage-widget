import React from "react";
import { useUsageData } from "@renderer/hooks/useUsageData";
import { WidgetHeader, SizeOption } from "./WidgetHeader";
import { Footer } from "./Footer";
import { AlertBanner } from "./AlertBanner";
import { ProviderType } from "@shared/types";

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

function ProgressBar({
  percent,
  trackClass,
  fillClass,
  height = 8,
}: {
  percent: number;
  trackClass: string;
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
      <rect className={trackClass} x="0" y="0" width="100" height={height} rx={height / 2} />
      <rect className={fillClass} x="0" y="0" width={width} height={height} rx={height / 2} />
    </svg>
  );
}

export function MiniView({
  provider,
  onProviderChange,
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
  provider: ProviderType;
  onProviderChange: (provider: ProviderType) => void;
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
  const { usageData, isLoading, lastUpdated } = useUsageData(provider);

  if (isLoading || !usageData) {
    return (
      <div className="flex h-full items-center justify-center bg-transparent">
        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-[#2a2a2a] border-t-indigo-500" />
      </div>
    );
  }

  const sessionPct = Math.min(100, Math.max(0, usageData.percentageUsed));
  const resetDiff =
    usageData.resetTime != null
      ? new Date(usageData.resetTime).getTime() - Date.now()
      : null;
  const sessionActive = resetDiff !== null && resetDiff <= 5 * 60 * 60 * 1000;
  const sessionError = resetDiff !== null && resetDiff > 5 * 60 * 60 * 1000;

  return (
    <div className="box-border bg-transparent p-2">
      <div
        data-widget-card
        className="flex flex-col overflow-visible rounded-[14px] border border-white/10 bg-[rgba(24,24,27,0.97)]"
        onMouseEnter={onAlertHoverStart}
        onMouseLeave={onAlertHoverEnd}
      >
        {alertMessage ? (
          <AlertBanner
            message={alertMessage}
            className="rounded-t-[14px]"
            onIgnore={onAlertIgnore}
          />
        ) : null}
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
          onHardLogout={onHardLogout}
          onRemove={onRemove}
        />

        <div className="h-px bg-white/10" />

        <div className="px-3.5 pb-3.5 pt-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-white">Current session</span>
            <span className="text-[11px] font-medium tabular-nums text-white/50">
              {Math.round(sessionPct)}% used
            </span>
          </div>

          {sessionError ? (
            <div className="mb-1.5 text-[10px] text-red-400">
              Something&apos;s off — try restarting the widget
            </div>
          ) : !sessionActive ? (
            <div className="mb-1.5 text-[10px] text-white/30">
              Starts when a message is sent
            </div>
          ) : (
            <div className="mb-1.5 text-[10px] text-white/30">
              Resets in {formatSessionReset(new Date(usageData.resetTime!))}
            </div>
          )}

          <ProgressBar
            percent={sessionPct}
            trackClass="fill-white/10"
            fillClass="fill-blue-400"
            height={8}
          />

          <div className="-mx-3.5 my-1.5 h-px bg-white/10" />

          <Footer
            provider={provider}
            lastUpdated={lastUpdated ?? usageData.timestamp ?? null}
            label={usageData.userName}
            onRefresh={() =>
              (window as any).electron?.ipcRenderer?.invoke("poller:start", provider)
            }
            paddingClass="px-0 pb-0 pt-0.5"
            borderTopClass="border-0"
            labelGapClass="mb-0.5"
          />
        </div>
      </div>
    </div>
  );
}
