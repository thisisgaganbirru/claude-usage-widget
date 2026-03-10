import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { SizeOption } from "./WidgetHeader";

interface WidgetMenuProps {
  isOpen: boolean;
  position: { top: number; left: number };
  selectedSize: SizeOption;
  isPinned?: boolean;
  onTogglePin?: (pinned: boolean) => void;
  onSizeChange?: (size: SizeOption) => void;
  onLogout?: () => void;
  onRemove?: () => void;
  onClose: () => void;
}

export function WidgetMenu({
  isOpen,
  position,
  selectedSize,
  isPinned = true,
  onTogglePin,
  onSizeChange,
  onLogout,
  onRemove,
  onClose,
}: WidgetMenuProps): React.ReactElement | null {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const muted = "rgba(255,255,255,0.45)";
  const dimmer = "rgba(255,255,255,0.28)";

  // Close when window loses focus (click on desktop/other app)
  useEffect(() => {
    if (!isOpen) return;
    const close = () => onClose();
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <>
      {/* Invisible full-screen backdrop — catches all outside clicks */}
      <div
        onMouseDown={() => onClose()}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
        }}
      />
      <div
        onMouseDown={(e) => e.stopPropagation()}
        data-widget-menu
        style={{
          position: "fixed",
          top: position.top,
          left: position.left,
          width: 200,
          background: "rgba(28,28,31,0.98)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
          zIndex: 9999,
          padding: "6px 0",
        }}
      >
        {/* Size label */}
        <div
          style={{
            padding: "4px 12px 5px",
            color: dimmer,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            userSelect: "none",
          }}
        >
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
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 12px",
                background:
                  hoveredItem === size
                    ? "rgba(255,255,255,0.06)"
                    : "transparent",
                border: "none",
                color: active ? "#fff" : muted,
                fontSize: 13,
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.15s",
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  border: `2px solid ${active ? "#C15F3C" : "rgba(255,255,255,0.22)"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {active && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#C15F3C",
                    }}
                  />
                )}
              </span>
              {size}
            </button>
          );
        })}

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.07)",
            margin: "5px 0",
          }}
        />

        <button
          onClick={() => {
            onTogglePin?.(!isPinned);
            onClose();
          }}
          onMouseEnter={() => setHoveredItem("pin")}
          onMouseLeave={() => setHoveredItem(null)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "7px 12px",
            background:
              hoveredItem === "pin" ? "rgba(255,255,255,0.06)" : "transparent",
            border: "none",
            color: "rgba(255,255,255,0.6)",
            fontSize: 13,
            cursor: "pointer",
            textAlign: "left",
            transition: "background 0.15s",
          }}
        >
          <span>{isPinned ? "Unpin from top" : "Pin to top"}</span>
          <span style={{ color: isPinned ? "#C15F3C" : "rgba(255,255,255,0.35)" }}>
            {isPinned ? "✓" : ""}
          </span>
        </button>

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.07)",
            margin: "5px 0",
          }}
        />

        {/* Logout */}
        <button
          onClick={() => {
            onLogout?.();
            onClose();
          }}
          onMouseEnter={() => setHoveredItem("logout")}
          onMouseLeave={() => setHoveredItem(null)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "7px 12px",
            background:
              hoveredItem === "logout" ? "rgba(239,68,68,0.08)" : "transparent",
            border: "none",
            color:
              hoveredItem === "logout" ? "#ef4444" : "rgba(255,255,255,0.6)",
            fontSize: 13,
            cursor: "pointer",
            textAlign: "left",
            transition: "background 0.15s",
          }}
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

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.07)",
            margin: "5px 0",
          }}
        />

        {/* Remove */}
        <button
          onClick={() => {
            onRemove?.();
            onClose();
          }}
          onMouseEnter={() => setHoveredItem("remove")}
          onMouseLeave={() => setHoveredItem(null)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "7px 12px",
            background:
              hoveredItem === "remove" ? "rgba(255,44,44,0.08)" : "transparent",
            border: "none",
            color: "#ef4444",
            fontSize: 13,
            cursor: "pointer",
            textAlign: "left",
            transition: "background 0.15s",
          }}
        >
          ✕&nbsp; Remove widget
        </button>
      </div>
    </>,
    document.body,
  );
}
