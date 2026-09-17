/**
 * The widget: a header, one card per reporting provider, a footer.
 *
 * This replaces MiniView, CompactView and ExpandedView, which were three
 * files differing only in how much of one provider they drew. Now that the
 * body is a list of `ProviderCard`s, that difference is one prop, and keeping
 * three copies of the same chrome only guaranteed they would drift.
 */
import React from "react";
import { useProviderList } from "@renderer/hooks/useProviderList";
import { WidgetHeader, SizeOption } from "./WidgetHeader";
import { Footer } from "./Footer";
import { AlertBanner } from "./AlertBanner";
import { ProviderCard, type CardDensity } from "./ProviderCard";
import type { ProviderId } from "@shared/usage";

const DENSITY_FOR_SIZE: Record<SizeOption, CardDensity> = {
  Small: "line",
  Medium: "card",
  Large: "full",
};

export interface WidgetViewProps {
  selectedSize: SizeOption;
  onSizeChange: (size: SizeOption) => void;
  isPinned?: boolean;
  onTogglePin?: (pinned: boolean) => void;
  onSignIn?: (providerId: ProviderId) => void;
  onLogout?: () => void;
  onHardLogout?: () => void;
  onRemove?: () => void;
  alertMessage?: string | null;
  onAlertIgnore?: () => void;
  onAlertHoverStart?: () => void;
  onAlertHoverEnd?: () => void;
}

export function WidgetView({
  selectedSize,
  onSizeChange,
  isPinned,
  onTogglePin,
  onSignIn,
  onLogout,
  onHardLogout,
  onRemove,
  alertMessage,
  onAlertIgnore,
  onAlertHoverStart,
  onAlertHoverEnd,
}: WidgetViewProps): React.ReactElement {
  const { providerIds, worst } = useProviderList();
  const density = DENSITY_FOR_SIZE[selectedSize];

  return (
    <div className="box-border bg-transparent p-2">
      <div
        data-widget-card
        className="flex flex-col overflow-visible rounded-2xl border border-fg/10 bg-surface/[0.97] shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.04)]"
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
          worst={worst}
          selectedSize={selectedSize}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          onSizeChange={onSizeChange}
          onLogout={onLogout}
          onHardLogout={onHardLogout}
          onRemove={onRemove}
        />

        <div className="h-px bg-fg/10" />

        {providerIds.length === 0 ? (
          <div className="px-3.5 py-5 text-center text-[11px] text-fg/35">
            No providers are switched on. Open settings to enable one.
          </div>
        ) : (
          <div className="divide-y divide-fg/5">
            {providerIds.map((providerId) => (
              <ProviderCard
                key={providerId}
                providerId={providerId}
                density={density}
                onSignIn={onSignIn}
              />
            ))}
          </div>
        )}

        <Footer />
      </div>
    </div>
  );
}
