import React, { useEffect, useState } from "react";
import { useAuthStore } from "@renderer/store/auth-store";
import { useUsageStore } from "@renderer/store/usage-store";
import { LoginView } from "@renderer/components/auth/LoginView";
import { MiniView } from "@renderer/components/widget/MiniView";
import { CompactView } from "@renderer/components/widget/CompactView";
import { ExpandedView } from "@renderer/components/widget/ExpandedView";
import { SizeOption } from "@renderer/components/widget/WidgetHeader";

const isDev = process.env.NODE_ENV === "development";

declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>;
        send: (channel: string, ...args: any[]) => void;
        on: (channel: string, listener: (...args: any[]) => void) => void;
        once: (channel: string, listener: (...args: any[]) => void) => void;
        removeListener: (
          channel: string,
          listener: (...args: any[]) => void,
        ) => void;
        removeAllListeners: (channel: string) => void;
      };
    };
  }
}

const WINDOW_SIZES: Record<SizeOption, [number, number]> = {
  Small: [350, 80],
  Medium: [350, 345],
  Large: [350, 650],
};

const ClaudeUsageWidget = () => {
  const { isAuthenticated, checkSession, setAuthenticated } = useAuthStore();
  const fetchCurrent = useUsageStore((state) => state.fetchCurrent);
  const [selectedSize, setSelectedSize] = useState<SizeOption>("Small");
  const [isPinned, setIsPinned] = useState(true);

  const handleLogout = async () => {
    await window.electron.ipcRenderer.invoke("auth:logout").catch(() => {});
    setAuthenticated(false);
  };

  const handleRemove = () => {
    void window.electron.ipcRenderer.invoke("app:quit").catch(() => {});
  };

  const handleTogglePin = (pinned: boolean) => {
    setIsPinned(pinned);
    void window.electron.ipcRenderer
      .invoke("window:setPinned", pinned)
      .catch(() => {});
  };

  // Toggle mouse passthrough: forward:true means mousemove still reaches renderer
  // Only send IPC when state changes to avoid flooding
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    let ignoring = true;
    const onMouseMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const isTransparent =
        !el ||
        el.tagName === "HTML" ||
        el.tagName === "BODY" ||
        (!el.closest("[data-widget-card]") && !el.closest("[data-widget-menu]"));
      if (isTransparent !== ignoring) {
        ignoring = isTransparent;
        ipc.send("set-ignore-mouse-events", ignoring);
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, []);

  // Resize window based on auth state and selected size
  useEffect(() => {
    if (!isAuthenticated) {
      void window.electron.ipcRenderer
        .invoke("resize-window", 800, 600)
        .catch(() => {});
      return;
    }
    const [w, h] = WINDOW_SIZES[selectedSize];
    void window.electron.ipcRenderer
      .invoke("resize-window", w, h)
      .catch((error) => {
        console.error("[App] Failed to resize window:", error);
      });
  }, [selectedSize, isAuthenticated]);

  useEffect(() => {
    void checkSession();
    void window.electron.ipcRenderer
      .invoke("window:getPinned")
      .then((result) => {
        if (typeof result?.pinned === "boolean") setIsPinned(result.pinned);
      })
      .catch(() => {});

    const handleLoginSuccess = () => setAuthenticated(true);
    const handleRefreshNow = () => void fetchCurrent();
    const handleOpenSettings = () => {
      if (isDev) console.log("[App] Settings UI is not implemented yet");
    };

    window.electron.ipcRenderer.on("auth:login-success", handleLoginSuccess);
    window.electron.ipcRenderer.on("action:refreshNow", handleRefreshNow);
    window.electron.ipcRenderer.on("action:openSettings", handleOpenSettings);

    return () => {
      window.electron.ipcRenderer.removeListener(
        "auth:login-success",
        handleLoginSuccess,
      );
      window.electron.ipcRenderer.removeListener(
        "action:refreshNow",
        handleRefreshNow,
      );
      window.electron.ipcRenderer.removeListener(
        "action:openSettings",
        handleOpenSettings,
      );
    };
  }, [checkSession, fetchCurrent, setAuthenticated]);

  if (!isAuthenticated) {
    return <LoginView />;
  }

  if (selectedSize === "Medium") {
    return (
      <CompactView
        selectedSize={selectedSize}
        onSizeChange={setSelectedSize}
        isPinned={isPinned}
        onTogglePin={handleTogglePin}
        onLogout={handleLogout}
        onRemove={handleRemove}
      />
    );
  }
  if (selectedSize === "Large") {
    return (
      <ExpandedView
        selectedSize={selectedSize}
        onSizeChange={setSelectedSize}
        isPinned={isPinned}
        onTogglePin={handleTogglePin}
        onLogout={handleLogout}
        onRemove={handleRemove}
      />
    );
  }
  return (
    <MiniView
      selectedSize={selectedSize}
      onSizeChange={setSelectedSize}
      isPinned={isPinned}
      onTogglePin={handleTogglePin}
      onLogout={handleLogout}
      onRemove={handleRemove}
    />
  );
};

export default ClaudeUsageWidget;
