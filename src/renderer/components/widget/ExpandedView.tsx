import React from "react";
import { useProviderState } from "@renderer/hooks/useProviderState";
import { useProviderSettings } from "@renderer/hooks/useProviderSettings";
import { useNow } from "@renderer/hooks/useNow";
import { formatCountdown, formatResetDate } from "@renderer/format";
import { WidgetHeader, SizeOption } from "./WidgetHeader";
import { Footer } from "./Footer";
import { AlertBanner } from "./AlertBanner";
import {
  longestWindow,
  ModelWindowList,
  ProviderStatus,
  UsageWindowRow,
} from "./UsageWindows";
import { ProviderType } from "@shared/types";
import type { UsageWindow } from "@shared/usage";
import { tryBridge } from "@renderer/ipc/bridge";

/** The levels the card offers. Any other value set elsewhere is left alone. */
const THRESHOLD_CHOICES = [50, 75, 90, 95];

function ResetCard({ window }: { window: UsageWindow }): React.ReactElement {
  const now = useNow();
  const absolute = formatResetDate(window.resetsAt);

  return (
    <div className="mb-3 rounded-[10px] border border-[#C15F3C]/10 bg-[#C15F3C]/10 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-white/35">
          {window.label} resets in
        </span>
        <span className="text-base text-[#C15F3C]">
          {formatCountdown(window.resetsAt, now)}
        </span>
      </div>
      {absolute ? (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/25">Next reset</span>
          <span className="text-[11px] font-medium text-white/45">
            {absolute}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The percentages that raise an alert for this provider.
 *
 * These write one field of one provider's block. Under the old shape the card
 * sent back the whole settings object, so opening it in two windows and
 * clicking in each would silently undo the first click.
 */
function ThresholdEditor({
  provider,
}: {
  provider: ProviderType;
}): React.ReactElement | null {
  const { settings, isSaving, update } = useProviderSettings(provider);
  if (!settings) return null;

  const toggle = (threshold: number): void => {
    const next = settings.thresholds.includes(threshold)
      ? settings.thresholds.filter((value) => value !== threshold)
      : [...settings.thresholds, threshold].sort((a, b) => a - b);
    void update({ thresholds: next });
  };

  return (
    <div className="mb-3 rounded-[10px] bg-white/5 px-3 py-2.5">
      <div className="mb-2 text-[9px] font-semibold tracking-[0.06em] text-white/30">
        ALERT THRESHOLDS
      </div>
      <div className="flex gap-1.5">
        {THRESHOLD_CHOICES.map((threshold) => (
          <button
            key={threshold}
            onClick={() => toggle(threshold)}
            disabled={isSaving}
            className={`flex-1 rounded-md border py-[5px] text-center text-[10px] font-semibold transition-colors disabled:opacity-60 ${
              settings.thresholds.includes(threshold)
                ? "border-[#C15F3C]/25 bg-[#C15F3C]/10 text-[#C15F3C]"
                : "border-white/10 text-white/25"
            }`}
          >
            {threshold}%
          </button>
        ))}
      </div>
      <div className="mt-1.5 text-[9px] text-white/25">
        Applies to every limit this provider reports
      </div>
    </div>
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
  const {
    state,
    windows,
    models,
    plan,
    accountLabel,
    fetchedAt,
    isStale,
    refresh,
  } = useProviderState(provider);

  const resetWindow = longestWindow(windows);
  const siteUrl =
    provider === "chatgpt" ? "https://chatgpt.com/" : "https://claude.ai";
  const settingsUrl =
    provider === "chatgpt"
      ? "https://chatgpt.com/"
      : "https://claude.ai/settings/general";

  return (
    <div className="h-auto overflow-y-visible bg-transparent">
      <div className="relative">
        <div
          data-widget-card
          className="overflow-visible rounded-[18px] border border-white/10 bg-[rgba(24,24,27,0.97)] shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-2xl"
          onMouseEnter={onAlertHoverStart}
          onMouseLeave={onAlertHoverEnd}
        >
          {alertMessage ? (
            <AlertBanner
              message={alertMessage}
              className="rounded-t-[18px]"
              onIgnore={onAlertIgnore}
            />
          ) : null}
          <div className="border-b border-white/5">
            <WidgetHeader
              provider={provider}
              onProviderChange={onProviderChange}
              planType={plan}
              isStale={isStale}
              selectedSize={selectedSize}
              isPinned={isPinned}
              onTogglePin={onTogglePin}
              onSizeChange={onSizeChange}
              onLogout={onLogout}
              onHardLogout={onHardLogout}
              onRemove={onRemove}
            />
          </div>

          <div className="px-[18px] pb-4 pt-4">
            {windows.length === 0 ? (
              <ProviderStatus state={state} />
            ) : (
              <>
                {windows.map((window) => (
                  <UsageWindowRow key={window.id} window={window} />
                ))}

                {models.length > 0 ? (
                  <div className="mb-[14px] mt-1 rounded-[10px] bg-white/5 px-3 py-3">
                    <ModelWindowList windows={models} />
                  </div>
                ) : null}

                {resetWindow ? <ResetCard window={resetWindow} /> : null}
              </>
            )}

            <ThresholdEditor provider={provider} />

            <div className="flex gap-1.5">
              <button
                onClick={() => void tryBridge()?.app.openExternal(siteUrl)}
                className="flex flex-1 items-center justify-center gap-[5px] rounded-lg border border-white/10 bg-white/5 py-[9px] text-[11px] font-semibold text-white/60"
              >
                <span className="text-[13px]">↗</span>{" "}
                {provider === "chatgpt" ? "Open ChatGPT" : "Open Claude"}
              </button>
              <button
                onClick={() => void tryBridge()?.app.openExternal(settingsUrl)}
                className="flex flex-1 items-center justify-center gap-[5px] rounded-lg border border-[#C15F3C]/20 bg-[#C15F3C]/10 py-[9px] text-[11px] font-semibold text-[#C15F3C]"
              >
                <span className="text-[11px]">⚙</span>{" "}
                {provider === "chatgpt" ? "Workspace" : "Settings"}
              </button>
            </div>
          </div>

          <Footer
            provider={provider}
            fetchedAt={fetchedAt}
            label={accountLabel}
            onRefresh={() => void refresh()}
          />
        </div>
      </div>
    </div>
  );
}
