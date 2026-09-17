import React, { useRef, useState } from "react";
import { WidgetMenu } from "./WidgetMenu";
import claudeIcon from "../../assets/ClaudeIcon-Square.svg";
import { providerLabel } from "@shared/provider-labels";
import type { WorstAcross } from "@shared/usage";

export type SizeOption = "Small" | "Medium" | "Large";

interface WidgetHeaderProps {
  /**
   * The provider closest to a wall, or null when none reports a number. This
   * is the same figure the tray icon colours itself by, deliberately: a user
   * glancing at the tray and then opening the widget should not be told two
   * different things.
   */
  worst: WorstAcross | null;
  selectedSize?: SizeOption;
  isPinned?: boolean;
  onTogglePin?: (pinned: boolean) => void;
  onSizeChange?: (size: SizeOption) => void;
  onLogout?: () => void;
  onHardLogout?: () => void;
  onRemove?: () => void;
}

export function WidgetHeader({
  worst,
  selectedSize = "Small",
  isPinned = true,
  onTogglePin,
  onSizeChange,
  onLogout,
  onHardLogout,
  onRemove,
}: WidgetHeaderProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="widget-drag flex items-center gap-2 px-3 pb-2.5 pt-[11px]">
      <img
        src={claudeIcon}
        className="h-[22px] w-[22px] shrink-0 select-none rounded-md"
        alt="Widget"
      />

      <span className="select-none text-[13px] font-semibold leading-none text-fg">
        Usage
      </span>

      {worst === null ? (
        <span className="flex-1 select-none truncate text-[10px] text-fg/30">
          Nothing reporting yet
        </span>
      ) : (
        <span className="flex-1 select-none truncate text-[10px] text-fg/45">
          {providerLabel(worst.providerId)} {worst.window.label} at{" "}
          <span className="tabular-nums text-fg/70">
            {Math.round(worst.window.usedPercent)}%
          </span>
          {worst.stale ? " (stale)" : ""}
        </span>
      )}

      <button
        onClick={() => onTogglePin?.(!isPinned)}
        title={isPinned ? "Unpin from top" : "Pin to top"}
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-fg/10 p-0 transition-colors ${
          isPinned
            ? "bg-[#C15F3C]/15 text-[#C15F3C]"
            : "bg-fg/[0.05] text-fg/45"
        }`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={isPinned ? "" : "opacity-80"}
        >
          <path d="M12 17v5" />
          <path d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6z" />
        </svg>
      </button>

      <div className="relative">
        <button
          ref={btnRef}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-fg/10 p-0 text-xs leading-none text-fg/45 transition-colors ${
            menuOpen ? "bg-fg/[0.12]" : "bg-fg/[0.05]"
          }`}
        >
          ⋯
        </button>

        <WidgetMenu
          isOpen={menuOpen}
          anchorRef={btnRef}
          selectedSize={selectedSize}
          onSizeChange={onSizeChange}
          onLogout={onLogout}
          onHardLogout={onHardLogout}
          onRemove={onRemove}
          onClose={() => setMenuOpen(false)}
        />
      </div>
    </div>
  );
}
