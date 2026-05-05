import React, { useState, useEffect } from "react";
import { SizeOption } from "./WidgetHeader";

interface WidgetMenuProps {
  isOpen: boolean;
  anchorRef: React.RefObject<HTMLElement>;
  selectedSize: SizeOption;
  onSizeChange?: (size: SizeOption) => void;
  onLogout?: () => void;
  onHardLogout?: () => void;
  onRemove?: () => void;
  onClose: () => void;
}

export function WidgetMenu({
  isOpen,
  anchorRef,
  selectedSize,
  onSizeChange,
  onLogout,
  onHardLogout,
  onRemove,
  onClose,
}: WidgetMenuProps): React.ReactElement | null {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  // Close when window loses focus (click on desktop/other app)
  useEffect(() => {
    if (!isOpen) return;
    const close = () => onClose();
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const anchorEl = anchorRef.current;
      const menuEl = document.querySelector("[data-widget-menu]");
      if (anchorEl?.contains(target)) return;
      if (menuEl?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen, anchorRef, onClose]);

  if (!isOpen) return null;

  return (
      <div
        onMouseDown={(e) => e.stopPropagation()}
        data-widget-menu
        className="absolute right-0 top-[calc(100%+4px)] z-[9999] w-[200px] rounded-[10px] border border-white/10 bg-[rgba(28,28,31,0.98)] py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
      >
        {/* Size label */}
        <div className="select-none px-3 pb-[5px] pt-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-white/30">
          Size
        </div>

        {(["Small", "Medium", "Large"] as SizeOption[]).map((size) => {
          const active = selectedSize === size;
          return (
            <button
              key={size}
              onClick={() => {
                onSizeChange?.(size);
                onClose();
              }}
              onMouseEnter={() => setHoveredItem(size)}
              onMouseLeave={() => setHoveredItem(null)}
              className={`flex w-full cursor-pointer items-center gap-2.5 border-0 px-3 py-1.5 text-left text-[13px] transition-colors ${
                hoveredItem === size ? "bg-white/[0.06]" : "bg-transparent"
              } ${active ? "text-white" : "text-white/45"}`}
            >
              <span
                className={`flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full border-2 ${
                  active ? "border-[#C15F3C]" : "border-white/[0.22]"
                }`}
              >
                {active && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-[#C15F3C]"
                  />
                )}
              </span>
              {size}
            </button>
          );
        })}

        {/* Divider */}
        <div className="my-[5px] h-px bg-white/[0.07]" />

        {/* Logout */}
        <button
          onClick={() => {
            onLogout?.();
            onClose();
          }}
          onMouseEnter={() => setHoveredItem("logout")}
          onMouseLeave={() => setHoveredItem(null)}
          className={`flex w-full cursor-pointer items-center gap-[9px] border-0 px-3 py-[7px] text-left text-[13px] transition-colors ${
            hoveredItem === "logout"
              ? "bg-red-500/10 text-red-500"
              : "bg-transparent text-white/60"
          }`}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign Out
        </button>

        <button
          onClick={() => {
            onHardLogout?.();
            onClose();
          }}
          onMouseEnter={() => setHoveredItem("logout_everywhere")}
          onMouseLeave={() => setHoveredItem(null)}
          className={`flex w-full cursor-pointer items-center gap-[9px] border-0 px-3 py-[7px] text-left text-[12px] transition-colors ${
            hoveredItem === "logout_everywhere"
              ? "bg-orange-500/10 text-orange-400"
              : "bg-transparent text-white/50"
          }`}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 4h16v16H4z" />
            <path d="M9 9l6 6" />
            <path d="M15 9l-6 6" />
          </svg>
          Sign out everywhere
        </button>

        {/* Divider */}
        <div className="my-[5px] h-px bg-white/[0.07]" />

        {/* Remove */}
        <button
          onClick={() => {
            onRemove?.();
            onClose();
          }}
          onMouseEnter={() => setHoveredItem("remove")}
          onMouseLeave={() => setHoveredItem(null)}
          className={`flex w-full cursor-pointer items-center gap-[9px] border-0 px-3 py-[7px] text-left text-[13px] text-red-500 transition-colors ${
            hoveredItem === "remove" ? "bg-red-500/10" : "bg-transparent"
          }`}
        >
          ✕&nbsp; Remove widget
        </button>
      </div>
  );
}
