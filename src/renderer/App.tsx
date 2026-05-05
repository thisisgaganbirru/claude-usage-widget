import React, { useEffect, useState } from "react";
import { useAuthStore } from "@renderer/store/auth-store";
import { LoginView } from "@renderer/components/auth/LoginView";
import { MiniView } from "@renderer/components/widget/MiniView";
import { CompactView } from "@renderer/components/widget/CompactView";
import { ExpandedView } from "@renderer/components/widget/ExpandedView";
import { SizeOption } from "@renderer/components/widget/WidgetHeader";
import { ProviderType } from "@shared/types";

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

export const App = () => {
  const {
    selectedProvider,
    setSelectedProvider,
    isAuthenticated,
    setAuthenticated,
    checkSession,
  } = useAuthStore();
  const [selectedSize, setSelectedSize] = useState<SizeOption>("Small");
  const [isPinned, setIsPinned] = useState(true);

  const handleProviderChange = async (provider: ProviderType) => {
    setSelectedProvider(provider);
    const authed = await checkSession(provider);
    if (authed) {
      void window.electron.ipcRenderer.invoke("poller:start", provider);
    }
  };

  const handleLogout = async () => {
    await window.electron.ipcRenderer
      .invoke("auth:logout", selectedProvider)
      .catch(() => {});
    setAuthenticated(false, selectedProvider);
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

  useEffect(() => {
    if (!isAuthenticated) {
      void window.electron.ipcRenderer
        .invoke("resize-window", 800, 600)
        .catch(() => {});
      return;
    }
    const [w, h] = WINDOW_SIZES[selectedSize];
    void window.electron.ipcRenderer.invoke("resize-window", w, h).catch(() => {});
  }, [selectedSize, isAuthenticated]);

  useEffect(() => {
    void Promise.all([checkSession("claude"), checkSession("chatgpt")]).then(
      ([claudeAuthed, chatgptAuthed]) => {
        const provider = claudeAuthed
          ? "claude"
          : chatgptAuthed
            ? "chatgpt"
            : "claude";
        setSelectedProvider(provider);
        if (claudeAuthed || chatgptAuthed) {
          void window.electron.ipcRenderer.invoke("poller:start", provider);
        }
      },
    );

    void window.electron.ipcRenderer
      .invoke("window:getPinned")
      .then((result) => {
        if (typeof result?.pinned === "boolean") setIsPinned(result.pinned);
      })
      .catch(() => {});
  }, [checkSession, setSelectedProvider]);

  if (!isAuthenticated) {
    return (
      <LoginView
        selectedProvider={selectedProvider}
        onProviderChange={handleProviderChange}
      />
    );
  }

  const sharedProps = {
    provider: selectedProvider,
    onProviderChange: handleProviderChange,
    selectedSize,
    onSizeChange: setSelectedSize,
    isPinned,
    onTogglePin: handleTogglePin,
    onLogout: handleLogout,
    onRemove: handleRemove,
  };

  if (selectedSize === "Medium") {
    return <CompactView {...sharedProps} />;
  }
  if (selectedSize === "Large") {
    return <ExpandedView {...sharedProps} />;
  }
  return <MiniView {...sharedProps} />;
};
