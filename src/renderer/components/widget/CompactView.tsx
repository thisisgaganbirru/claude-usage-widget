import React from "react";
import { useProviderState } from "@renderer/hooks/useProviderState";
import { useNow } from "@renderer/hooks/useNow";
import { formatCountdown } from "@renderer/format";
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

function Countdown({ window }: { window: UsageWindow }): React.ReactElement {
  const now = useNow();

  return (
    <div className="px-3.5 pb-3 pt-0.5">
      <div className="flex items-center justify-between rounded-[10px] bg-white/5 px-3.5 py-2.5">
        <span className="text-[11px] font-medium text-white/45">
          {window.label} resets in
        </span>
        <span className="tracking-[0.03em] text-[#C15F3C]">
          {formatCountdown(window.resetsAt, now)}
        </span>
      </div>
    </div>
  );
}

export function CompactView({
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

  const countdownWindow = longestWindow(windows);

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

        <div className="h-px bg-white/10" />

        {windows.length === 0 ? (
          <ProviderStatus state={state} />
        ) : (
          <>
            <div className="px-3.5 pb-[11px] pt-3">
              {windows.map((window) => (
                <UsageWindowRow key={window.id} window={window} />
              ))}
              <ModelWindowList windows={models} />
            </div>

            {countdownWindow ? <Countdown window={countdownWindow} /> : null}
          </>
        )}

        <Footer
          provider={provider}
          fetchedAt={fetchedAt}
          label={accountLabel}
          onRefresh={() => void refresh()}
        />
      </div>
    </div>
  );
}
