import { create } from "zustand";
import { UsageData } from "@shared/types";

interface UsageStoreState {
  usageData: UsageData | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;

  setUsageData: (data: UsageData | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setLastUpdated: (date: Date | null) => void;
  fetchCurrent: () => Promise<void>;
  reset: () => void;
}

const defaultUsageData: UsageData = {
  currentUsage: 0,
  planLimit: 100,
  percentageUsed: 0,
  resetTime: new Date(Date.now() + 86400000),
  sevenDayUsage: 0,
  sevenDayResetTime: new Date(Date.now() + 7 * 86400000),
  sessionActive: false,
  opusUsage: null,
  sonnetUsage: null,
  planType: "Unknown",
  modelInfo: "Unknown",
  userName: "Claude User",
  timestamp: new Date(),
};

export const useUsageStore = create<UsageStoreState>((set, get) => ({
  usageData: null,
  isLoading: false,
  error: null,
  lastUpdated: null,

  setUsageData: (data) => set({ usageData: data, error: null }),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  setLastUpdated: (date) => set({ lastUpdated: date }),

  fetchCurrent: async () => {
    set({ isLoading: true, error: null });
    try {
      const result =
        await window.electron.ipcRenderer.invoke("usage:getCurrent");
      if (result?.usageData) {
        // Convert date strings to Date objects
        const usageData = {
          ...result.usageData,
          resetTime: new Date(result.usageData.resetTime),
          timestamp: new Date(result.usageData.timestamp),
        };
        set({ usageData, lastUpdated: new Date(), isLoading: false });
      } else {
        set({ usageData: defaultUsageData, isLoading: false });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to fetch usage data";
      set({ error: errorMessage, isLoading: false });
    }
  },

  reset: () =>
    set({
      usageData: null,
      isLoading: false,
      error: null,
      lastUpdated: null,
    }),
}));
