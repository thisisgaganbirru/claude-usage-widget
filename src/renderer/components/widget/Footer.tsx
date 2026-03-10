import React from "react";

function formatLastUpdated(ts: Date | null): string {
  if (!ts) return "Never";
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} min ago`;
}

interface FooterProps {
  lastUpdated: Date | null;
  label?: string;
  onRefresh?: () => void;
  borderTop?: string;
  padding?: string;
  labelGap?: number;
}

export function Footer({
  lastUpdated,
  label,
  onRefresh,
  borderTop = "1px solid rgba(255,255,255,0.05)",
  padding = "8px 14px 12px",
  labelGap = 4,
}: FooterProps): React.ReactElement {
  const refreshBtn = (
    <span
      onClick={onRefresh}
      title="Refresh now"
      style={{ cursor: "pointer", color: "rgba(255,255,255,0.4)" }}
    >
      ↻
    </span>
  );

  return (
    <div style={{ borderTop, padding }}>
      {/* Row 1: username + external link */}
      {label && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            marginBottom: labelGap,
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.45)",
              fontWeight: 500,
            }}
          >
            {label}
          </span>
          <span
            title="Open Claude settings"
            onClick={() =>
              (window as any).electron?.ipcRenderer?.invoke(
                "app:openExternal",
                "https://claude.ai/settings/general",
              )
            }
            style={{ cursor: "pointer", lineHeight: 0, display: "inline-flex" }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255,255,255,0.25)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </span>
        </div>
      )}
      {/* Row 2: last updated (left) + version (right) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
          Last updated: {formatLastUpdated(lastUpdated)} {refreshBtn}
        </span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>
          v1.0
        </span>
      </div>
    </div>
  );
}
