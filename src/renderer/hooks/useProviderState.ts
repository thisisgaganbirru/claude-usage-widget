/**
 * One provider's state, kept current from the main process.
 *
 * The subscription is registered once for the whole app rather than once per
 * component: several views mount the same provider, and the old hook attached
 * a fresh set of IPC listeners for each of them.
 */
import { useEffect, useMemo } from "react";
import { useProviderStore } from "@renderer/store/provider-store";
import { tryBridge } from "@renderer/ipc/bridge";
import {
  modelWindows,
  topLevelWindows,
  worstWindow,
  type ProviderId,
  type ProviderState,
  type UsageWindow,
} from "@shared/usage";

export interface ProviderView {
  state: ProviderState;
  /** Windows that stand on their own. Empty unless the state is "ok". */
  windows: UsageWindow[];
  /** Per-model breakdowns, rendered under the totals. */
  models: UsageWindow[];
  /** The window closest to running out, or null. */
  worst: UsageWindow | null;
  accountLabel: string | null;
  plan: string | null;
  isRefreshing: boolean;
  isStale: boolean;
  fetchedAt: string | null;
  refresh: () => Promise<void>;
}

const NOT_DETECTED: ProviderState = { kind: "not-detected" };

/** Wire the bridge to the store exactly once, however many views mount. */
export function useProviderSubscription(): void {
  const applyState = useProviderStore((store) => store.applyState);
  const loadSnapshot = useProviderStore((store) => store.loadSnapshot);

  useEffect(() => {
    void loadSnapshot();
    const bridge = tryBridge();
    if (!bridge) return;

    return bridge.events.onProviderState((event) => {
      applyState(event.providerId, event.state);
    });
  }, [applyState, loadSnapshot]);
}

export function useProviderState(providerId: ProviderId): ProviderView {
  const state = useProviderStore(
    (store) => store.states[providerId] ?? NOT_DETECTED,
  );
  const isRefreshing = useProviderStore(
    (store) => store.refreshing[providerId] ?? false,
  );
  const refreshAll = useProviderStore((store) => store.refresh);

  const usage = state.kind === "ok" ? state.usage : null;

  const windows = useMemo(
    () => (usage ? topLevelWindows(usage.windows) : []),
    [usage],
  );
  const models = useMemo(
    () => (usage ? modelWindows(usage.windows) : []),
    [usage],
  );
  const worst = useMemo(() => worstWindow(windows), [windows]);

  return {
    state,
    windows,
    models,
    worst,
    accountLabel: usage?.accountLabel ?? null,
    plan: usage?.plan ?? null,
    isRefreshing,
    isStale: state.kind === "ok" && state.staleSince !== undefined,
    fetchedAt: usage?.fetchedAt ?? null,
    refresh: () => refreshAll(providerId),
  };
}
