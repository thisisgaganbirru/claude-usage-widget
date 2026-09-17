/**
 * The widget's bottom line: refresh everything, and the version.
 *
 * It used to carry one provider's account label and a link to that vendor's
 * settings page, which only made sense while the widget showed one provider
 * at a time. Those moved onto the cards; what is left here is genuinely
 * app-level.
 */
import React, { useEffect, useState } from "react";
import { useProviderStore } from "@renderer/store/provider-store";
import { tryBridge } from "@renderer/ipc/bridge";

export function Footer(): React.ReactElement {
  const [version, setVersion] = useState("...");
  const refresh = useProviderStore((store) => store.refresh);

  useEffect(() => {
    tryBridge()
      ?.app.getVersion()
      .then((result) => {
        if (result?.version) setVersion(result.version);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex items-center justify-between border-t border-fg/5 px-3.5 pb-2.5 pt-2">
      <button
        onClick={() => void refresh()}
        className="text-[10px] text-fg/30 transition-colors hover:text-fg/60"
      >
        ↻ Refresh all
      </button>
      <span className="text-[10px] text-fg/15">v{version}</span>
    </div>
  );
}
