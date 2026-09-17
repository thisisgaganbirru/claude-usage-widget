/**
 * Every provider's state, keyed by provider id.
 *
 * The old store held one Claude-shaped `UsageData` per provider and invented a
 * placeholder object whenever it had nothing, which is how the widget ended up
 * showing a confident "0% used, resets in 24h" for a provider it had never
 * read. Here the absence of a reading is a state of its own, and the UI says so.
 */
import { create } from "zustand";
import type { ProviderId, ProviderState } from "@shared/usage";
import { tryBridge } from "@renderer/ipc/bridge";

export interface ProviderStoreState {
  states: Partial<Record<ProviderId, ProviderState>>;
  /** When this renderer last received a state for the provider, in ms. */
  receivedAt: Partial<Record<ProviderId, number>>;
  refreshing: Partial<Record<ProviderId, boolean>>;
  applyState: (providerId: ProviderId, state: ProviderState) => void;
  loadSnapshot: () => Promise<void>;
  refresh: (providerId?: ProviderId) => Promise<void>;
  reset: () => void;
}

export const useProviderStore = create<ProviderStoreState>((set) => ({
  states: {},
  receivedAt: {},
  refreshing: {},

  applyState: (providerId, state) => {
    set((current) => ({
      states: { ...current.states, [providerId]: state },
      receivedAt: { ...current.receivedAt, [providerId]: Date.now() },
      refreshing: { ...current.refreshing, [providerId]: false },
    }));
  },

  loadSnapshot: async () => {
    const bridge = tryBridge();
    if (!bridge) return;

    const result = await bridge.providers.snapshot();
    const now = Date.now();
    const states: Partial<Record<ProviderId, ProviderState>> = {};
    const receivedAt: Partial<Record<ProviderId, number>> = {};
    for (const entry of result.providers) {
      states[entry.providerId] = entry.state;
      receivedAt[entry.providerId] = now;
    }
    set({ states, receivedAt });
  },

  refresh: async (providerId) => {
    const bridge = tryBridge();
    if (!bridge) return;

    if (providerId !== undefined) {
      set((current) => ({
        refreshing: { ...current.refreshing, [providerId]: true },
      }));
    }

    try {
      await bridge.providers.refresh(providerId);
    } finally {
      // The scheduler pushes the new state itself; this only clears the
      // spinner, including on the path where the poll failed.
      if (providerId !== undefined) {
        set((current) => ({
          refreshing: { ...current.refreshing, [providerId]: false },
        }));
      }
    }
  },

  reset: () => set({ states: {}, receivedAt: {}, refreshing: {} }),
}));
