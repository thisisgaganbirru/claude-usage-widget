import { useEffect } from "react";
import { useUsageStore } from "@renderer/store/usage-store";
import { useAuthStore } from "@renderer/store/auth-store";
import { UsageData } from "@shared/types";

const isDev = process.env.NODE_ENV === "development";

/**
 * Custom hook for listening to usage data updates from main process
 * Automatically sets up IPC listeners and handles updates
 */
export function useUsageData() {
  const { setUsageData, setLastUpdated, setError, fetchCurrent } =
    useUsageStore();
  const clearAuth = useAuthStore((state) => state.clearAuth);

  useEffect(() => {
    // Fetch current data immediately
    fetchCurrent();

    // Listen for usage updates from main process
    const handleUsageUpdate = (data: { usageData: UsageData }) => {
      if (data?.usageData) {
        // Convert date strings to Date objects
        const usageData = {
          ...data.usageData,
          resetTime: new Date(data.usageData.resetTime),
          timestamp: new Date(data.usageData.timestamp),
        };
        setUsageData(usageData);
        setLastUpdated(new Date());
        if (isDev) console.log("[useUsageData] Usage updated:", usageData);
      }
    };

    // Listen for poll errors
    const handlePollError = (data: { error: string }) => {
      console.error("[useUsageData] Poll error:", data.error);
      setError(data.error);
    };

    // Listen for auth expiration
    const handleAuthExpired = () => {
      console.warn("[useUsageData] Auth expired");
      clearAuth();
      setError("Session expired. Please log in again.");
    };

    // Register listeners
    window.electron.ipcRenderer.on("usage:updated", handleUsageUpdate);
    window.electron.ipcRenderer.on("poller:error", handlePollError);
    window.electron.ipcRenderer.on("auth:expired", handleAuthExpired);

    // Cleanup listeners
    return () => {
      window.electron.ipcRenderer.removeListener(
        "usage:updated",
        handleUsageUpdate,
      );
      window.electron.ipcRenderer.removeListener(
        "poller:error",
        handlePollError,
      );
      window.electron.ipcRenderer.removeListener(
        "auth:expired",
        handleAuthExpired,
      );
    };
  }, [clearAuth, setUsageData, setLastUpdated, setError, fetchCurrent]);

  // Return the store's getter functions
  return useUsageStore();
}
