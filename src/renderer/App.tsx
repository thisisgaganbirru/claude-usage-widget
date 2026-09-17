import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@renderer/store/auth-store";
import { LoginView } from "@renderer/components/auth/LoginView";
import { WidgetView } from "@renderer/components/widget/WidgetView";
import { SettingsPanel } from "@renderer/components/settings/SettingsPanel";
import { SizeOption } from "@renderer/components/widget/WidgetHeader";
import { useProviderSubscription } from "@renderer/hooks/useProviderState";
import { useProviderList } from "@renderer/hooks/useProviderList";
import { useTheme } from "@renderer/hooks/useTheme";
import {
  hasLoginFlow,
  ProviderType,
  SettingsPatch,
  ThresholdCrossedEvent,
  WidgetSettings,
} from "@shared/types";
import { providerLabel } from "@shared/provider-labels";
import type { ProviderId } from "@shared/usage";
import { tryBridge } from "@renderer/ipc/bridge";
import {
  SETTINGS_WINDOW_SIZE,
  WIDGET_WIDTH,
  widgetHeight,
} from "@renderer/layout";

const isDev = process.env.NODE_ENV === "development";

export const App = () => {
  const {
    selectedProvider,
    setSelectedProvider,
    setAuthenticated,
    checkSession,
    loadAccounts,
  } = useAuthStore();
  // One subscription for the whole app; every view reads the store it fills.
  useProviderSubscription();
  const { providerIds } = useProviderList();
  const [selectedSize, setSelectedSize] = useState<SizeOption>("Small");
  const [isPinned, setIsPinned] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [signingIn, setSigningIn] = useState<ProviderType | null>(null);
  const [settings, setSettings] = useState<WidgetSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  const [thresholdAlertMessage, setThresholdAlertMessage] = useState<
    string | null
  >(null);
  const [thresholdAlertVisible, setThresholdAlertVisible] = useState(false);
  const [thresholdAlertActive, setThresholdAlertActive] = useState(false);
  const [alertHiddenMode, setAlertHiddenMode] = useState<
    "none" | "ignore" | "timeout"
  >("none");
  const [didShowAlertPreview, setDidShowAlertPreview] = useState(false);
  const alertTimerRef = useRef<number | null>(null);

  useTheme(settings?.theme ?? "auto");

  // These three are memoised because the effects below list them as
  // dependencies. Redefining them each render would re-subscribe every IPC
  // listener on every state change, which is how the threshold alert used to
  // fire twice for one crossing.
  const clearAlertTimer = useCallback(() => {
    if (alertTimerRef.current !== null) {
      window.clearTimeout(alertTimerRef.current);
      alertTimerRef.current = null;
    }
  }, []);

  const startAlertTimer = useCallback(() => {
    clearAlertTimer();
    alertTimerRef.current = window.setTimeout(() => {
      setThresholdAlertVisible(false);
      setAlertHiddenMode("timeout");
    }, 120000);
  }, [clearAlertTimer]);

  const showAlertForEvent = useCallback(
    (message: string) => {
      setThresholdAlertMessage(message);
      setThresholdAlertActive(true);
      setThresholdAlertVisible(true);
      setAlertHiddenMode("none");
      startAlertTimer();
    },
    [startAlertTimer],
  );

  const loadSettings = async () => {
    try {
      const bridge = tryBridge();
      if (!bridge) {
        throw new Error("Settings are available inside the desktop app.");
      }
      setSettingsError(null);
      setSettings(await bridge.settings.get());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load settings";
      setSettingsError(message);
    }
  };

  const saveSettings = async (patch: SettingsPatch) => {
    setIsSettingsSaving(true);
    setSettingsError(null);
    try {
      const bridge = tryBridge();
      if (!bridge) {
        throw new Error("Settings are available inside the desktop app.");
      }
      const result = await bridge.settings.update(patch);
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

  /**
   * Only providers with a sign-in flow can be signed in to. The rest read a
   * credential another tool wrote, so there is nothing to open here.
   */
  const handleSignIn = (providerId: ProviderId) => {
    if (!hasLoginFlow(providerId)) return;
    setSelectedProvider(providerId);
    setSigningIn(providerId);
  };

  const handleProviderChange = async (provider: ProviderType) => {
    setSelectedProvider(provider);
    setSigningIn(provider);
    const authed = await checkSession(provider);
    if (authed) void tryBridge()?.providers.refresh(provider);
  };

  const handleLogout = async () => {
    await tryBridge()
      ?.auth.logout(selectedProvider)
      .catch(() => {});
    setAuthenticated(false, selectedProvider);
  };

  const handleHardLogout = async () => {
    await tryBridge()
      ?.auth.logoutEverywhere()
      .catch(() => {});
    setAuthenticated(false);
  };

  const handleRemove = () => {
    void tryBridge()
      ?.app.quit()
      .catch(() => {});
  };

  const handleTogglePin = (pinned: boolean) => {
    setIsPinned(pinned);
    void tryBridge()
      ?.window.setPinned(pinned)
      .catch(() => {});
  };

  useEffect(() => {
    const bridge = tryBridge();
    if (!bridge) return;
    let ignoring = true;
    const onMouseMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const isTransparent =
        !el ||
        el.tagName === "HTML" ||
        el.tagName === "BODY" ||
        (!el.closest("[data-widget-card]") &&
          !el.closest("[data-widget-menu]"));
      if (isTransparent !== ignoring) {
        ignoring = isTransparent;
        bridge.window.setIgnoreMouseEvents(ignoring);
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, []);

  useEffect(() => {
    const bridge = tryBridge();
    if (!bridge) return;
    const [width, height] =
      isSettingsOpen || signingIn !== null
        ? SETTINGS_WINDOW_SIZE
        : [WIDGET_WIDTH, widgetHeight(selectedSize, providerIds.length)];
    void bridge.window.resize(width, height).catch((error) => {
      console.error("[App] Failed to resize window:", error);
    });
  }, [selectedSize, isSettingsOpen, signingIn, providerIds.length]);

  useEffect(() => {
    const bridge = tryBridge();
    void loadSettings();
    void loadAccounts("claude");
    void loadAccounts("chatgpt");
    void Promise.all([checkSession("claude"), checkSession("chatgpt")]);

    if (!bridge) return;

    void bridge.window
      .getPinned()
      .then((result) => {
        if (typeof result?.pinned === "boolean") setIsPinned(result.pinned);
      })
      .catch(() => {});

    const handleLoginSuccess = () => {
      setAuthenticated(true);
      setSigningIn(null);
    };
    const handleRefreshNow = () => {
      void bridge.providers.refresh();
    };
    const handleOpenSettings = async () => {
      setIsSettingsOpen(true);
      await loadSettings();
    };
    // The window's own label plus two numbers. The old text hardcoded
    // "weekly limit", which was wrong for every window that was not weekly.
    const handleThreshold = (event: ThresholdCrossedEvent) => {
      showAlertForEvent(
        `${providerLabel(event.providerId)} ${event.windowLabel} is at ` +
          `${Math.round(event.usedPercent)}% (alert set at ${event.threshold}%).`,
      );
    };

    const unsubscribes = [
      bridge.events.onLoginSuccess(handleLoginSuccess),
      bridge.events.onRefreshNow(handleRefreshNow),
      bridge.events.onOpenSettings(() => void handleOpenSettings()),
      bridge.events.onThresholdCrossed(handleThreshold),
    ];

    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [checkSession, loadAccounts, setAuthenticated, showAlertForEvent]);

  useEffect(() => {
    if (!isDev || didShowAlertPreview) return;

    setDidShowAlertPreview(true);
    showAlertForEvent("Claude 7d weekly is at 75% (alert set at 75%).");
    return () => clearAlertTimer();
  }, [didShowAlertPreview, showAlertForEvent, clearAlertTimer]);

  useEffect(() => {
    return () => clearAlertTimer();
  }, [clearAlertTimer]);

  const handleAlertIgnore = () => {
    setThresholdAlertVisible(false);
    setAlertHiddenMode("ignore");
    clearAlertTimer();
  };

  const handleAlertHoverStart = () => {
    if (
      thresholdAlertActive &&
      !thresholdAlertVisible &&
      alertHiddenMode !== "none"
    ) {
      setThresholdAlertVisible(true);
    }
  };

  const handleAlertHoverEnd = () => {
    if (thresholdAlertActive && alertHiddenMode !== "none") {
      setThresholdAlertVisible(false);
    }
  };

  const activeAlertMessage = thresholdAlertVisible
    ? thresholdAlertMessage
    : null;

  if (signingIn !== null) {
    return (
      <LoginView
        selectedProvider={signingIn}
        onProviderChange={(provider) => void handleProviderChange(provider)}
        onClose={() => setSigningIn(null)}
      />
    );
  }

  if (isSettingsOpen && !settings) {
    return (
      <div
        data-widget-card
        className="flex h-full w-full items-center justify-center bg-sunken"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fg/15 border-t-[#C15F3C]" />
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

  return (
    <WidgetView
      selectedSize={selectedSize}
      onSizeChange={setSelectedSize}
      isPinned={isPinned}
      onTogglePin={handleTogglePin}
      onSignIn={handleSignIn}
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
