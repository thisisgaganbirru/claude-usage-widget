import { create } from "zustand";
import { ProviderAccount, ProviderType } from "@shared/types";
import { IPC_INVOKE_CHANNELS } from "@shared/ipc-channels";

interface AuthStoreState {
  selectedProvider: ProviderType;
  accountsByProvider: Record<ProviderType, ProviderAccount[]>;
  authByProvider: Record<ProviderType, boolean>;
  isAuthenticated: boolean;
  setSelectedProvider: (provider: ProviderType) => void;
  setAuthenticated: (isAuthenticated: boolean, provider?: ProviderType) => void;
  clearAuth: (provider?: ProviderType) => void;
  checkSession: (provider?: ProviderType) => Promise<boolean>;
  loadAccounts: (provider?: ProviderType) => Promise<void>;
  setActiveAccount: (
    provider: ProviderType,
    accountId: string,
  ) => Promise<boolean>;
}

const DEFAULT_PROVIDER: ProviderType = "claude";

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  selectedProvider: DEFAULT_PROVIDER,
  accountsByProvider: { claude: [], chatgpt: [] },
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
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) {
        return false;
      }

      const result = await ipc.invoke(
        IPC_INVOKE_CHANNELS.AUTH_CHECK_SESSION,
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

  loadAccounts: async (provider) => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const target = provider ?? get().selectedProvider;
    const result = await ipc
      .invoke(IPC_INVOKE_CHANNELS.AUTH_LIST_ACCOUNTS, target)
      .catch(() => null);
    if (!Array.isArray(result?.accounts)) return;
    set((state) => ({
      accountsByProvider: {
        ...state.accountsByProvider,
        [target]: result.accounts as ProviderAccount[],
      },
    }));
  },

  setActiveAccount: async (provider, accountId) => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return false;
    const result = await ipc
      .invoke(IPC_INVOKE_CHANNELS.AUTH_SET_ACTIVE_ACCOUNT, provider, accountId)
      .catch(() => null);
    if (!result?.success) return false;
    await get().loadAccounts(provider);
    await get().checkSession(provider);
    return true;
  },
}));
