import { create } from "zustand";
import { ProviderType } from "@shared/types";

interface AuthStoreState {
  selectedProvider: ProviderType;
  authByProvider: Record<ProviderType, boolean>;
  isAuthenticated: boolean;
  setSelectedProvider: (provider: ProviderType) => void;
  setAuthenticated: (isAuthenticated: boolean, provider?: ProviderType) => void;
  clearAuth: (provider?: ProviderType) => void;
  checkSession: (provider?: ProviderType) => Promise<boolean>;
}

const DEFAULT_PROVIDER: ProviderType = "claude";

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  selectedProvider: DEFAULT_PROVIDER,
  authByProvider: { claude: false, chatgpt: false },
  isAuthenticated: false,

  setSelectedProvider: (provider) => {
    const auth = get().authByProvider[provider];
    set({ selectedProvider: provider, isAuthenticated: auth });
  },

  setAuthenticated: (isAuthenticated, provider) => {
    const target = provider ?? get().selectedProvider;
    const nextMap = { ...get().authByProvider, [target]: isAuthenticated };
    set({
      authByProvider: nextMap,
      isAuthenticated:
        target === get().selectedProvider
          ? isAuthenticated
          : nextMap[get().selectedProvider],
    });
  },

  clearAuth: (provider) => {
    const target = provider ?? get().selectedProvider;
    const nextMap = { ...get().authByProvider, [target]: false };
    set({
      authByProvider: nextMap,
      isAuthenticated: nextMap[get().selectedProvider],
    });
  },

  checkSession: async (provider) => {
    const target = provider ?? get().selectedProvider;
    try {
      const result = await window.electron.ipcRenderer.invoke(
        "auth:checkSession",
        target,
      );
      const authenticated = Boolean(result?.isAuthenticated);
      const nextMap = { ...get().authByProvider, [target]: authenticated };
      set({
        authByProvider: nextMap,
        isAuthenticated:
          target === get().selectedProvider
            ? authenticated
            : nextMap[get().selectedProvider],
      });
      return authenticated;
    } catch (error) {
      console.error("[AuthStore] Failed to check session:", error);
      const nextMap = { ...get().authByProvider, [target]: false };
      set({
        authByProvider: nextMap,
        isAuthenticated:
          target === get().selectedProvider
            ? false
            : nextMap[get().selectedProvider],
      });
      return false;
    }
  },
}));
