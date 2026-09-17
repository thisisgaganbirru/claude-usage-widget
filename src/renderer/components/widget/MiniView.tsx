import React from "react";
import { useProviderState } from "@renderer/hooks/useProviderState";
import { WidgetHeader, SizeOption } from "./WidgetHeader";
import { Footer } from "./Footer";
import { AlertBanner } from "./AlertBanner";
import { ProviderStatus, UsageWindowRow } from "./UsageWindows";
import { ProviderType } from "@shared/types";

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
  const { state, worst, plan, accountLabel, fetchedAt, isStale, refresh } =
    useProviderState(provider);

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

        {/* The smallest size shows only the window closest to running out. */}
        {worst === null ? (
          <ProviderStatus state={state} />
        ) : (
          <div className="px-3.5 pb-3.5 pt-2">
            <UsageWindowRow window={worst} compact />

            <div className="-mx-3.5 my-1.5 h-px bg-white/10" />

            <Footer
              provider={provider}
              fetchedAt={fetchedAt}
              label={accountLabel}
              onRefresh={() => void refresh()}
              paddingClass="px-0 pb-0 pt-0.5"
              borderTopClass="border-0"
              labelGapClass="mb-0.5"
            />
          </div>
        )}
      </div>
    </div>
  );
}
