import React, { useEffect, useState } from "react";
import { ProviderType } from "@shared/types";

function formatLastUpdated(ts: Date | null): string {
  if (!ts) return "Never";
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} min ago`;
}

interface FooterProps {
  provider: ProviderType;
  lastUpdated: Date | null;
  label?: string;
  onRefresh?: () => void;
  borderTopClass?: string;
  paddingClass?: string;
  labelGapClass?: string;
}

export function Footer({
  provider,
  lastUpdated,
  label,
  onRefresh,
  borderTopClass = "border-t border-white/5",
  paddingClass = "px-3.5 pb-3 pt-2",
  labelGapClass = "mb-1",
}: FooterProps): React.ReactElement {
  const [version, setVersion] = useState("...");
  useEffect(() => {
    (window as any).electron?.ipcRenderer
      ?.invoke("app:getVersion")
      .then((r: any) => { if (r?.version) setVersion(r.version); })
      .catch(() => {});
  }, []);
  const refreshBtn = (
    <span
      onClick={onRefresh}
      title="Refresh now"
      className="cursor-pointer text-white/40"
    >
      ↻
    </span>
  );

  const settingsUrl =
    provider === "chatgpt"
      ? "https://chatgpt.com/"
      : "https://claude.ai/settings/general";
  const settingsLabel = provider === "chatgpt" ? "Open ChatGPT" : "Open Claude settings";

  return (
    <div className={`${borderTopClass} ${paddingClass}`}>
      {/* Row 1: username + external link */}
      {label && (
        <div
          className={`mb-1 flex items-center gap-1.5 ${labelGapClass}`}
        >
          <span
            className="text-[10px] font-medium text-white/45"
          >
            {label}
          </span>
          <span
            title={settingsLabel}
            onClick={() =>
              (window as any).electron?.ipcRenderer?.invoke(
                "app:openExternal",
                settingsUrl,
              )
            }
            className="inline-flex cursor-pointer leading-none"
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
        className="flex items-center justify-between"
      >
        <span className="text-[10px] text-white/25">
          Last updated: {formatLastUpdated(lastUpdated)} {refreshBtn}
        </span>
        <span className="text-[10px] text-white/15">
          v{version}
        </span>
      </div>
    </div>
  );
}
