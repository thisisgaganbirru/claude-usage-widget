import React, { useState, useRef } from "react";
import { WidgetMenu } from "./WidgetMenu";
import claudeIcon from "../../assets/ClaudeIcon-Square.svg";

export type SizeOption = "Small" | "Medium" | "Large";

interface WidgetHeaderProps {
  planType: string;
  userName?: string;
  selectedSize?: SizeOption;
  isPinned?: boolean;
  onTogglePin?: (pinned: boolean) => void;
  onSizeChange?: (size: SizeOption) => void;
  onLogout?: () => void;
  onRemove?: () => void;
}

export function WidgetHeader({
  planType,
  userName,
  selectedSize = "Small",
  isPinned = true,
  onTogglePin,
  onSizeChange,
  onLogout,
  onRemove,
}: WidgetHeaderProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen((v) => !v);
  };

  return (
    <div className="widget-drag flex items-center gap-2 px-3 pb-2.5 pt-[11px]">
      {/* Claude logo */}
      <img
        src={claudeIcon}
        className="h-[22px] w-[22px] shrink-0 select-none rounded-md"
        alt="Claude"
      />

      {/* Title */}
      <span className="flex-1 select-none text-[13px] font-semibold leading-none text-white">
        Claude Usage Widget
      </span>

      {/* Plan badge */}
      <span className="select-none whitespace-nowrap rounded-[20px] border border-white/10 bg-white/[0.07] px-[7px] py-0.5 text-[10px] font-medium text-white/45">
        {planType || "Pro"}
      </span>

      {/* Pin toggle */}
      <button
        onClick={() => onTogglePin?.(!isPinned)}
        title={isPinned ? "Unpin from top" : "Pin to top"}
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-white/10 p-0 transition-colors ${
          isPinned
            ? "bg-[#C15F3C]/15 text-[#C15F3C]"
            : "bg-white/[0.05] text-white/45"
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

      {/* ⋯ menu trigger */}
      <div className="relative">
        <button
          ref={btnRef}
          onClick={openMenu}
          className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-white/10 p-0 text-xs leading-none text-white/45 transition-colors ${
            menuOpen ? "bg-white/[0.12]" : "bg-white/[0.05]"
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
          onRemove={onRemove}
          onClose={() => setMenuOpen(false)}
        />
      </div>
    </div>
  );
}
