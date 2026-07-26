import { useEffect } from "react";
import { useUsageStore } from "@renderer/store/usage-store";
import { useAuthStore } from "@renderer/store/auth-store";
import { AuthExpiredEvent, ProviderType, UsageData } from "@shared/types";

const isDev = process.env.NODE_ENV === "development";

export interface ProviderUsageState {
  usageData: UsageData | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  fetchCurrent: () => Promise<void>;
}

function normalizeUsageData(raw: UsageData): UsageData {
  return {
    ...raw,
    resetTime: raw.resetTime ? new Date(raw.resetTime) : null,
    sevenDayResetTime: new Date(raw.sevenDayResetTime),
    timestamp: new Date(raw.timestamp),
  };
}

export function useUsageData(provider: ProviderType): ProviderUsageState {
  const usageStore = useUsageStore();
  const clearAuth = useAuthStore((state) => state.clearAuth);

  useEffect(() => {
    void usageStore.fetchCurrent(provider);
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    const handleUsageUpdate = (data: { usageData: UsageData }) => {
      if (!data?.usageData || data.usageData.provider !== provider) return;
      const usageData = normalizeUsageData(data.usageData);
      usageStore.setUsageData(provider, usageData);
      usageStore.setLastUpdated(provider, new Date());
      if (isDev) {
        console.log(`[useUsageData] ${provider} usage updated`, usageData);
      }
    };

    const handlePollError = (data: { provider?: ProviderType; error: string }) => {
      if (data?.provider && data.provider !== provider) return;
      usageStore.setError(provider, data?.error ?? "Unknown polling error");
    };

    const handleAuthExpired = (event?: AuthExpiredEvent) => {
      if (event?.provider && event.provider !== provider) return;
      if (isDev) console.warn("[useUsageData] Auth expired", event);
      clearAuth(provider);
      usageStore.setError(
        provider,
        event?.message ?? "Session expired. Please log in again.",
      );
    };

    ipc.on("usage:updated", handleUsageUpdate);
    ipc.on("poller:error", handlePollError);
    ipc.on("auth:expired", handleAuthExpired);

    return () => {
      ipc.removeListener(
        "usage:updated",
        handleUsageUpdate,
      );
      ipc.removeListener(
        "poller:error",
        handlePollError,
      );
      ipc.removeListener(
        "auth:expired",
        handleAuthExpired,
      );
    };
  }, [clearAuth, provider, usageStore]);

  return {
    usageData: usageStore.usageByProvider[provider] ?? null,
    isLoading: usageStore.isLoadingByProvider[provider],
    error: usageStore.errorByProvider[provider] ?? null,
    lastUpdated: usageStore.lastUpdatedByProvider[provider] ?? null,
    fetchCurrent: async () => usageStore.fetchCurrent(provider),
  };
}
