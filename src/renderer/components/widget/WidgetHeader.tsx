import React, { useRef, useState } from "react";
import { WidgetMenu } from "./WidgetMenu";
import claudeIcon from "../../assets/ClaudeIcon-Square.svg";
import { ProviderType } from "@shared/types";

export type SizeOption = "Small" | "Medium" | "Large";

interface WidgetHeaderProps {
  provider: ProviderType;
  onProviderChange: (provider: ProviderType) => void;
  planType: string;
  userName?: string;
  selectedSize?: SizeOption;
  isPinned?: boolean;
  onTogglePin?: (pinned: boolean) => void;
  onSizeChange?: (size: SizeOption) => void;
  onLogout?: () => void;
  onHardLogout?: () => void;
  onRemove?: () => void;
}

export function WidgetHeader({
  provider,
  onProviderChange,
  planType,
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
    <div className="widget-drag flex flex-col gap-2 px-3 pb-2.5 pt-[11px]">
      <div className="flex items-center gap-2">
        <img
          src={claudeIcon}
          className="h-[22px] w-[22px] shrink-0 select-none rounded-md"
          alt="Widget"
        />

        <span className="flex-1 select-none text-[13px] font-semibold leading-none text-white">
          Usage Widget
        </span>

        <span className="select-none whitespace-nowrap rounded-[20px] border border-white/10 bg-white/[0.07] px-[7px] py-0.5 text-[10px] font-medium text-white/45">
          {planType || "Plan"}
        </span>

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

        <div className="relative">
          <button
            ref={btnRef}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
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
            onHardLogout={onHardLogout}
            onRemove={onRemove}
            onClose={() => setMenuOpen(false)}
          />
        </div>
      </div>

      <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-1">
        {(["claude", "chatgpt"] as ProviderType[]).map((candidate) => {
          const active = provider === candidate;
          return (
            <button
              key={candidate}
              onClick={() => onProviderChange(candidate)}
              className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                active
                  ? "bg-[#C15F3C]/20 text-[#C15F3C]"
                  : "text-white/45 hover:text-white/70"
              }`}
            >
              {candidate === "claude" ? "Claude" : "ChatGPT"}
            </button>
          );
        })}
      </div>
    </div>
  );
}
