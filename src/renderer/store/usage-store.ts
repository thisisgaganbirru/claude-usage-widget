import { create } from "zustand";
import { ProviderType, UsageData } from "@shared/types";

export interface UsageStoreState {
  usageByProvider: Partial<Record<ProviderType, UsageData>>;
  lastUpdatedByProvider: Partial<Record<ProviderType, Date>>;
  isLoadingByProvider: Record<ProviderType, boolean>;
  errorByProvider: Partial<Record<ProviderType, string>>;
  setUsageData: (provider: ProviderType, data: UsageData | null) => void;
  setLoading: (provider: ProviderType, loading: boolean) => void;
  setError: (provider: ProviderType, error: string | null) => void;
  setLastUpdated: (provider: ProviderType, date: Date | null) => void;
  fetchCurrent: (provider: ProviderType) => Promise<void>;
  reset: (provider?: ProviderType) => void;
}

function createDefaultUsageData(provider: ProviderType): UsageData {
  return {
    provider,
    currentUsage: 0,
    planLimit: 100,
    percentageUsed: 0,
    resetTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
    sevenDayUsage: 0,
    sevenDayResetTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    sessionActive: false,
    opusUsage: null,
    sonnetUsage: null,
    planType: "Unknown",
    modelInfo: "Unknown",
    userName: provider === "chatgpt" ? "ChatGPT User" : "Claude User",
    timestamp: new Date(),
  };
}

function normalizeUsageData(provider: ProviderType, raw: UsageData): UsageData {
  return {
    ...raw,
    provider,
    resetTime: raw.resetTime ? new Date(raw.resetTime) : null,
    sevenDayResetTime: new Date(raw.sevenDayResetTime),
    timestamp: new Date(raw.timestamp),
  };
}

export const useUsageStore = create<UsageStoreState>((set, get) => ({
  usageByProvider: {},
  lastUpdatedByProvider: {},
  isLoadingByProvider: { claude: false, chatgpt: false },
  errorByProvider: {},

  setUsageData: (provider, data) => {
    set((state) => {
      const nextUsage = { ...state.usageByProvider };
      if (data) nextUsage[provider] = data;
      else delete nextUsage[provider];
      return {
        usageByProvider: nextUsage,
        errorByProvider: { ...state.errorByProvider, [provider]: undefined },
      };
    });
  },

  setLoading: (provider, loading) => {
    set((state) => ({
      isLoadingByProvider: { ...state.isLoadingByProvider, [provider]: loading },
    }));
  },

  setError: (provider, error) => {
    set((state) => ({
      errorByProvider: { ...state.errorByProvider, [provider]: error ?? undefined },
    }));
  },

  setLastUpdated: (provider, date) => {
    set((state) => ({
      lastUpdatedByProvider: {
        ...state.lastUpdatedByProvider,
        [provider]: date ?? undefined,
      },
    }));
  },

  fetchCurrent: async (provider) => {
    get().setLoading(provider, true);
    get().setError(provider, null);
    try {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) {
        const fallback = createDefaultUsageData(provider);
        set((state) => ({
          usageByProvider: { ...state.usageByProvider, [provider]: fallback },
          isLoadingByProvider: { ...state.isLoadingByProvider, [provider]: false },
        }));
        return;
      }

      const result = await ipc.invoke(
        "usage:getCurrent",
        provider,
      );
      if (result?.usageData) {
        const usageData = normalizeUsageData(provider, result.usageData as UsageData);
        set((state) => ({
          usageByProvider: { ...state.usageByProvider, [provider]: usageData },
          lastUpdatedByProvider: {
            ...state.lastUpdatedByProvider,
            [provider]: new Date(),
          },
          isLoadingByProvider: { ...state.isLoadingByProvider, [provider]: false },
          errorByProvider: { ...state.errorByProvider, [provider]: undefined },
        }));
      } else {
        const fallback = createDefaultUsageData(provider);
        set((state) => ({
          usageByProvider: { ...state.usageByProvider, [provider]: fallback },
          isLoadingByProvider: { ...state.isLoadingByProvider, [provider]: false },
        }));
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to fetch usage data";
      set((state) => ({
        errorByProvider: { ...state.errorByProvider, [provider]: errorMessage },
        isLoadingByProvider: { ...state.isLoadingByProvider, [provider]: false },
      }));
    }
  },

  reset: (provider) => {
    if (!provider) {
      set({
        usageByProvider: {},
        lastUpdatedByProvider: {},
        isLoadingByProvider: { claude: false, chatgpt: false },
        errorByProvider: {},
      });
      return;
    }

    set((state) => {
      const usageByProvider = { ...state.usageByProvider };
      delete usageByProvider[provider];
      return {
        usageByProvider,
        lastUpdatedByProvider: {
          ...state.lastUpdatedByProvider,
          [provider]: undefined,
        },
        isLoadingByProvider: { ...state.isLoadingByProvider, [provider]: false },
        errorByProvider: { ...state.errorByProvider, [provider]: undefined },
      };
    });
  },
}));
