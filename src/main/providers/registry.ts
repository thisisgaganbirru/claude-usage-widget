/**
 * The providers this build ships. Phases P2 through P4 add entries here and
 * change nothing else: the scheduler, the settings schema and the renderer all
 * work from this list rather than from a hardcoded vendor set.
 */
import type { ProviderId } from "@shared/usage";
import { chatgptProvider } from "./chatgpt";
import { claudeProvider } from "./claude";
import { codexProvider } from "./codex";
import { copilotProvider } from "./copilot";
import type { UsageProvider } from "./types";

const REGISTRY: ReadonlyMap<ProviderId, UsageProvider> = new Map([
  [claudeProvider.id, claudeProvider],
  [chatgptProvider.id, chatgptProvider],
  [codexProvider.id, codexProvider],
  [copilotProvider.id, copilotProvider],
]);

export function getProvider(id: ProviderId): UsageProvider | null {
  return REGISTRY.get(id) ?? null;
}

export function listProviders(): UsageProvider[] {
  return [...REGISTRY.values()];
}

/** Ids that have an adapter, in registration order. */
export function registeredProviderIds(): ProviderId[] {
  return [...REGISTRY.keys()];
}
