import React, { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@renderer/store/auth-store";
import { useUsageStore } from "@renderer/store/usage-store";
import { LoginView } from "@renderer/components/auth/LoginView";
import { MiniView } from "@renderer/components/widget/MiniView";
import { CompactView } from "@renderer/components/widget/CompactView";
import { ExpandedView } from "@renderer/components/widget/ExpandedView";
import { SettingsPanel } from "@renderer/components/settings/SettingsPanel";
import { SizeOption } from "@renderer/components/widget/WidgetHeader";
import { ThresholdCrossedEvent, WidgetSettings } from "@shared/types";

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
const SETTINGS_WINDOW_SIZE: [number, number] = [800, 600];

export const App = () => {
  const { isAuthenticated, checkSession, setAuthenticated } = useAuthStore();
  const fetchCurrent = useUsageStore((state) => state.fetchCurrent);
  const [selectedSize, setSelectedSize] = useState<SizeOption>("Small");
  const [isPinned, setIsPinned] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<WidgetSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  const [thresholdAlertMessage, setThresholdAlertMessage] = useState<string | null>(null);
  const [thresholdAlertVisible, setThresholdAlertVisible] = useState(false);
  const [thresholdAlertActive, setThresholdAlertActive] = useState(false);
  const [alertHiddenMode, setAlertHiddenMode] = useState<"none" | "ignore" | "timeout">("none");
  const [didShowAlertPreview, setDidShowAlertPreview] = useState(false);
  const alertTimerRef = useRef<number | null>(null);

  const clearAlertTimer = () => {
    if (alertTimerRef.current !== null) {
      window.clearTimeout(alertTimerRef.current);
      alertTimerRef.current = null;
    }
  };

  const startAlertTimer = () => {
    clearAlertTimer();
    alertTimerRef.current = window.setTimeout(() => {
      setThresholdAlertVisible(false);
      setAlertHiddenMode("timeout");
    }, 120000);
  };

  const showAlertForEvent = (message: string) => {
    setThresholdAlertMessage(message);
    setThresholdAlertActive(true);
    setThresholdAlertVisible(true);
    setAlertHiddenMode("none");
    startAlertTimer();
  };

  const loadSettings = async () => {
    try {
      setSettingsError(null);
      const nextSettings =
        await window.electron.ipcRenderer.invoke("settings:get");
      setSettings(nextSettings);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load settings";
      setSettingsError(message);
    }
  };

  const saveSettings = async (nextSettings: WidgetSettings) => {
    setIsSettingsSaving(true);
    setSettingsError(null);
    try {
      const result = await window.electron.ipcRenderer.invoke(
        "settings:update",
        nextSettings,
      );
      if (result?.settings) {
        setSettings(result.settings);
      } else {
        throw new Error("Settings update failed");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save settings";
      setSettingsError(message);
    } finally {
      setIsSettingsSaving(false);
    }
  };

  const handleLogout = async () => {
    await window.electron.ipcRenderer.invoke("auth:logout").catch(() => {});
    setAuthenticated(false);
  };

  const handleHardLogout = async () => {
    await window.electron.ipcRenderer
      .invoke("auth:logoutEverywhere")
      .catch(() => {});
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
    if (isSettingsOpen) {
      void window.electron.ipcRenderer
        .invoke("resize-window", SETTINGS_WINDOW_SIZE[0], SETTINGS_WINDOW_SIZE[1])
        .catch(() => {});
      return;
    }
    const [w, h] = WINDOW_SIZES[selectedSize];
    void window.electron.ipcRenderer
      .invoke("resize-window", w, h)
      .catch((error) => {
        console.error("[App] Failed to resize window:", error);
      });
  }, [selectedSize, isAuthenticated, isSettingsOpen]);

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
    const handleOpenSettings = async () => {
      setIsSettingsOpen(true);
      await loadSettings();
    };
    const handleThreshold = (event: ThresholdCrossedEvent) => {
      const roundedUsage = Math.round(event.percentage);
      if (event.scope === "weekly") {
        showAlertForEvent(
          `Alert: Your weekly limit crossed ${event.threshold}%. Use wisely.`,
        );
      } else {
        showAlertForEvent(
          `Alert: You have consumed ${roundedUsage}% (threshold ${event.threshold}%).`,
        );
      }
    };

    window.electron.ipcRenderer.on("auth:login-success", handleLoginSuccess);
    window.electron.ipcRenderer.on("action:refreshNow", handleRefreshNow);
    window.electron.ipcRenderer.on("action:openSettings", handleOpenSettings);
    window.electron.ipcRenderer.on("notification:threshold", handleThreshold);

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
      window.electron.ipcRenderer.removeListener(
        "notification:threshold",
        handleThreshold,
      );
    };
  }, [checkSession, fetchCurrent, setAuthenticated]);

  useEffect(() => {
    if (!isDev || !isAuthenticated || didShowAlertPreview) return;

    setDidShowAlertPreview(true);
    showAlertForEvent("Alert: Your weekly limit crossed 75%. Use wisely.");
    return () => clearAlertTimer();
  }, [didShowAlertPreview, isAuthenticated]);

  useEffect(() => {
    return () => clearAlertTimer();
  }, []);

  const handleAlertIgnore = () => {
    setThresholdAlertVisible(false);
    setAlertHiddenMode("ignore");
    clearAlertTimer();
  };

  const handleAlertHoverStart = () => {
    if (thresholdAlertActive && !thresholdAlertVisible && alertHiddenMode !== "none") {
      setThresholdAlertVisible(true);
    }
  };

  const handleAlertHoverEnd = () => {
    if (thresholdAlertActive && alertHiddenMode !== "none") {
      setThresholdAlertVisible(false);
    }
  };

  const activeAlertMessage = thresholdAlertVisible ? thresholdAlertMessage : null;

  if (!isAuthenticated) {
    return <LoginView />;
  }

  if (isSettingsOpen && !settings) {
    return (
      <div
        data-widget-card
        className="flex h-full w-full items-center justify-center bg-[#0f0f11]"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-[#C15F3C]" />
      </div>
    );
  }

  if (isSettingsOpen && settings) {
    return (
      <SettingsPanel
        settings={settings}
        isSaving={isSettingsSaving}
        error={settingsError}
        onClose={() => setIsSettingsOpen(false)}
        onSave={saveSettings}
        onLogout={handleLogout}
        onQuit={handleRemove}
      />
    );
  }

  if (selectedSize === "Medium") {
    return (
      <CompactView
        selectedSize={selectedSize}
        onSizeChange={setSelectedSize}
        isPinned={isPinned}
        onTogglePin={handleTogglePin}
        onLogout={handleLogout}
        onHardLogout={handleHardLogout}
        onRemove={handleRemove}
        alertMessage={activeAlertMessage}
        onAlertIgnore={handleAlertIgnore}
        onAlertHoverStart={handleAlertHoverStart}
        onAlertHoverEnd={handleAlertHoverEnd}
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
        onHardLogout={handleHardLogout}
        onRemove={handleRemove}
        alertMessage={activeAlertMessage}
        onAlertIgnore={handleAlertIgnore}
        onAlertHoverStart={handleAlertHoverStart}
        onAlertHoverEnd={handleAlertHoverEnd}
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
      onHardLogout={handleHardLogout}
      onRemove={handleRemove}
      alertMessage={activeAlertMessage}
      onAlertIgnore={handleAlertIgnore}
      onAlertHoverStart={handleAlertHoverStart}
      onAlertHoverEnd={handleAlertHoverEnd}
    />
  );
};
