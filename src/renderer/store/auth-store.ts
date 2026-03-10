import { create } from 'zustand';
import { AuthState } from '@shared/types';

interface AuthStoreState extends AuthState {
  setAuthenticated: (isAuthenticated: boolean) => void;
  setSessionCookie: (cookie: string | null) => void;
  setExpiresAt: (expiresAt: number | null) => void;
  clearAuth: () => void;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthStoreState>((set) => ({
  isAuthenticated: false,
  sessionCookie: null,
  expiresAt: null,

  setAuthenticated: (isAuthenticated) => set({ isAuthenticated }),

  setSessionCookie: (sessionCookie) => set({ sessionCookie }),

  setExpiresAt: (expiresAt) => set({ expiresAt }),

  clearAuth: () =>
    set({
      isAuthenticated: false,
      sessionCookie: null,
      expiresAt: null,
    }),

  checkSession: async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('auth:checkSession');
      set({ isAuthenticated: result.isAuthenticated });
    } catch (error) {
      console.error('[AuthStore] Failed to check session:', error);
      set({ isAuthenticated: false });
    }
  },
}));
