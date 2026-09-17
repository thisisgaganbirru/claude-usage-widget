/**
 * GitHub Copilot provider.
 *
 * Credential: the `gho_` OAuth token the Copilot editor plugins already
 * store, read from `apps.json`. No login flow, no expiry, no refresh.
 *
 * Data source: `api.github.com/copilot_internal/user`, which is what the
 * plugins themselves call for the quota banner.
 *
 * Headers are listed here per ADR-0003. The editor headers are load-bearing:
 * this is an internal endpoint that expects an editor client, and it is the
 * only source of the entitlement denominator. Every documented billing
 * endpoint has been probed by others and none reports a seat's ceiling.
 */
import * as os from "os";
import { createLogger } from "@main/logging/logger";
import type { ProviderUsage } from "@shared/usage";
import { httpGet } from "../http";
import { parseJson } from "../schema";
import { ProviderError, type Credential, type UsageProvider } from "../types";
import { readCopilotToken } from "./auth";
import { normalizeCopilotUsage } from "./normalize";
import { appsFileCandidates } from "./paths";

const log = createLogger("providers/copilot");

const GITHUB_HOST = "github.com";

/** Quotas reset monthly, so a slow cadence loses nothing. */
const DEFAULT_INTERVAL_SEC = 300;

/**
 * The headers the Copilot plugins send. The versions are pinned strings: there
 * is no editor here to read a version from, and announcing a plausible one is
 * what keeps an editor-only endpoint answering. ADR-0003 records this.
 */
const EDITOR_HEADERS: Readonly<Record<string, string>> = {
  Accept: "application/json",
  "Editor-Version": "vscode/1.96.2",
  "Editor-Plugin-Version": "copilot-chat/0.26.7",
  "User-Agent": "GitHubCopilotChat/0.26.7",
  "X-Github-Api-Version": "2025-04-01",
};

/** `api.github.com` for github.com, `api.<host>` for an enterprise install. */
export function usageUrlFor(host: string): string {
  const apiHost = host === GITHUB_HOST ? "api.github.com" : `api.${host}`;
  return `https://${apiHost}/copilot_internal/user`;
}

function candidates(): string[] {
  return appsFileCandidates({
    env: process.env,
    homeDir: os.homedir(),
    platform: process.platform,
  });
}

export const copilotProvider: UsageProvider = {
  id: "copilot",
  displayName: "GitHub Copilot",
  defaultIntervalSec: DEFAULT_INTERVAL_SEC,

  async discoverCredentials(): Promise<Credential | null> {
    const found = await readCopilotToken(candidates());
    if (found === null) return null;
    return {
      providerId: "copilot",
      kind: "bearer",
      secret: found.token,
      // The token carries no expiry of its own; GitHub revokes it instead.
      expiresAt: null,
      accountLabel: found.user ?? undefined,
    };
  },

  async fetchUsage(cred: Credential): Promise<ProviderUsage> {
    if (cred.kind !== "bearer") {
      throw new ProviderError(
        "auth",
        "The Copilot provider needs an OAuth token",
      );
    }

    // The host lives on the token's own file entry, and the credential does
    // not carry it, so it is resolved again here. It is one small file read.
    const found = await readCopilotToken(candidates());
    const host = found?.host ?? GITHUB_HOST;

    const body = await httpGet({
      url: usageUrlFor(host),
      headers: { ...EDITOR_HEADERS, Authorization: `token ${cred.secret}` },
    });
    log.debug("usage response received", { bytes: body.length });

    return normalizeCopilotUsage(parseJson(body, "copilot_internal/user"), {
      accountLabel: found?.user ?? cred.accountLabel ?? "Copilot",
      fetchedAt: new Date().toISOString(),
    });
  },
};
