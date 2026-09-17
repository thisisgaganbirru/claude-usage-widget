/**
 * How each provider is named in text the user reads.
 *
 * Shared rather than per-process: the tray tooltip, a desktop notification
 * and the settings window all name the same provider, and they were drifting
 * apart when each one hardcoded its own string.
 */
import type { ProviderId } from "./usage";

const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  codex: "Codex",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
  gemini: "Gemini",
};

export function providerLabel(id: ProviderId): string {
  return PROVIDER_LABELS[id] ?? "Provider";
}
