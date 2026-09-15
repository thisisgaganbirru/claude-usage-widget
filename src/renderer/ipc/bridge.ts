/**
 * The renderer's only door to the main process.
 *
 * Everything in the UI goes through `getBridge()` or `tryBridge()`, so there
 * is a single place to look when asking what the renderer can actually do,
 * and a single place that copes with the bridge being absent.
 *
 * `getBridge()` throws when the preload has not run, because a component that
 * needs the bridge has no sensible behaviour without it. `tryBridge()` returns
 * null instead, for the cases where doing nothing is the right answer, like a
 * cleanup path or an optional refresh.
 */
import type { QuotaWidgetApi } from "@shared/ipc-contract";

export class BridgeUnavailableError extends Error {
  constructor() {
    super(
      "The main-process bridge is unavailable. The preload script did not run.",
    );
    this.name = "BridgeUnavailableError";
  }
}

export function tryBridge(): QuotaWidgetApi | null {
  if (typeof window === "undefined") return null;
  return window.quotaWidget ?? null;
}

export function getBridge(): QuotaWidgetApi {
  const bridge = tryBridge();
  if (!bridge) throw new BridgeUnavailableError();
  return bridge;
}

export function isBridgeAvailable(): boolean {
  return tryBridge() !== null;
}
