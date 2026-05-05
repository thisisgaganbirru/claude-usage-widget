import React from "react";

interface AlertBannerProps {
  message: string;
  className?: string;
  onIgnore?: () => void;
}

export function AlertBanner({
  message,
  className = "rounded-t-[14px]",
  onIgnore,
}: AlertBannerProps): React.ReactElement {
  const hasAlertPrefix = message.startsWith("Alert:");
  const remainder = hasAlertPrefix ? message.slice("Alert:".length).trim() : message;

  return (
    <div
      className={`threshold-alert-blink flex items-end justify-start border-b border-[#fca5a5]/55 bg-[#dc2626] px-3 py-0.5 text-left text-[9px] font-semibold tracking-[0.02em] text-white ${className}`}
    >
      <div className="flex w-full items-end justify-between gap-3">
        <span>
          {hasAlertPrefix ? (
            <span>
              <span className="underline decoration-white/90 underline-offset-[2px]">
                Alert
              </span>
              : {remainder}
            </span>
          ) : (
            message
          )}
        </span>
        {onIgnore ? (
          <button
            onClick={onIgnore}
            className="text-[9px] font-semibold text-white/90 underline decoration-white/80 underline-offset-[2px]"
          >
            Ignore
          </button>
        ) : null}
      </div>
    </div>
  );
}
