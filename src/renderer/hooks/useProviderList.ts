/**
 * Which providers the widget shows, and which one is closest to a wall.
 *
 * The widget used to render one provider at a time, chosen by a toggle in the
 * header, which worked while there were two. With six it hides most of what it
 * knows behind a control the user has to remember to click, and a limit you
 * cannot see is a limit you hit.
 *
 * The order is fixed rather than sorted by usage. Sorting worst-first sounds
 * better and is worse to use: cards would swap places under the cursor on
 * every poll. The headline carries the "who should I worry about" signal
 * instead, so nothing has to move for it to be visible.
 */
import { useMemo } from "react";
import { useProviderStore } from "@renderer/store/provider-store";
import {
  PROVIDER_IDS,
  worstAcrossProviders,
  type ProviderId,
  type ProviderStateEntry,
  type WorstAcross,
} from "@shared/usage";

export interface ProviderListView {
  /** Reporting providers in a fixed order, whatever their state. */
  providerIds: ProviderId[];
  /** The entries behind them, for anything that aggregates. */
  entries: ProviderStateEntry[];
  /** The provider closest to a wall, or null when none reports a number. */
  worst: WorstAcross | null;
}

export function useProviderList(): ProviderListView {
  const states = useProviderStore((store) => store.states);

  return useMemo(() => {
    const entries: ProviderStateEntry[] = [];
    for (const providerId of PROVIDER_IDS) {
      const state = states[providerId];
      if (state !== undefined) entries.push({ providerId, state });
    }
    const providerIds = entries.map((entry) => entry.providerId);
    return { providerIds, entries, worst: worstAcrossProviders(entries) };
  }, [states]);
}
