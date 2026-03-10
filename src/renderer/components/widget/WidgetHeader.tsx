import React, { useState, useRef, useEffect } from "react";
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
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const muted = "rgba(255,255,255,0.45)";

  // Expand window when menu opens so the portal isn't clipped, restore on close
  useEffect(() => {
    if (menuOpen) {
      void window.electron.ipcRenderer.invoke("resize-window", 350, 280);
    } else {
      // restore original size after menu closes
      const sizes: Record<SizeOption, [number, number]> = {
        Small: [350, 80],
        Medium: [350, 345],
        Large: [350, 650],
      };
      const [w, h] = sizes[selectedSize];
      void window.electron.ipcRenderer.invoke("resize-window", w, h);
    }
  }, [menuOpen, selectedSize]);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const left = Math.min(rect.right - 200, window.innerWidth - 208);
    setMenuPos({ top: rect.bottom + 4, left });
    setMenuOpen((v) => !v);
  };

  return (
    <div
      className="widget-drag"
      style={{
        padding: "11px 12px 10px",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {/* Claude logo */}
      <img
        src={claudeIcon}
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          flexShrink: 0,
          userSelect: "none",
        }}
        alt="Claude"
      />

      {/* Title */}
      <span
        style={{
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          flex: 1,
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        Claude Usage Widget
      </span>

      {/* Plan badge */}
      <span
        style={{
          background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: muted,
          fontSize: 10,
          fontWeight: 500,
          padding: "2px 7px",
          borderRadius: 20,
          whiteSpace: "nowrap",
          userSelect: "none",
        }}
      >
        {planType || "Pro"}
      </span>

      {/* ⋯ menu trigger */}
      <div style={{ position: "relative" }}>
        <button
          ref={btnRef}
          onClick={openMenu}
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: menuOpen
              ? "rgba(255,255,255,0.12)"
              : "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: muted,
            fontSize: 12,
            lineHeight: "1",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            flexShrink: 0,
            transition: "background 0.15s",
          }}
        >
          ⋯
        </button>

        <WidgetMenu
          isOpen={menuOpen}
          position={menuPos}
          selectedSize={selectedSize}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          onSizeChange={onSizeChange}
          onLogout={onLogout}
          onRemove={onRemove}
          onClose={() => setMenuOpen(false)}
        />
      </div>
    </div>
  );
}
