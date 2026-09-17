/**
 * Gemini CLI provider.
 *
 * Credential: the Google OAuth token the Gemini CLI already stored in
 * `~/.gemini/oauth_creds.json`. Read in place, never written back, never
 * refreshed. `auth.ts` sets out why the refresh is left out and where it would
 * plug in.
 *
 * Data source: the Code Assist endpoints the CLI itself calls,
 * `v1internal:loadCodeAssist` for the tier and `v1internal:retrieveUserQuota`
 * for the per-model allowances. Both are POSTs even though both are reads,
 * which is Google's design, not a choice here.
 *
 * Headers are listed here per ADR-0003: a bearer token and the CLI's own
 * identity, no browser User-Agent.
 */
import * as os from "os";
import { createLogger } from "@main/logging/logger";
import type { ProviderUsage } from "@shared/usage";
import { httpPost } from "../http";
import { parseJson } from "../schema";
import { ProviderError, type Credential, type UsageProvider } from "../types";
import { discoverGeminiCredentials, isUsable, REQUIRED_SCOPE } from "./auth";
import {
  normalizeGeminiQuota,
  planFromTier,
  projectFromLoad,
} from "./normalize";
import { accountsFile, credsFile } from "./paths";

const log = createLogger("providers/gemini");

const BASE_URL = "https://cloudcode-pa.googleapis.com/v1internal";
export const LOAD_URL = `${BASE_URL}:loadCodeAssist`;
export const QUOTA_URL = `${BASE_URL}:retrieveUserQuota`;

/** Allowances move slowly, so a slow cadence loses nothing. */
const DEFAULT_INTERVAL_SEC = 300;

const CLIENT_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": "GeminiCLI/0.1.0",
};

/**
 * The tier and project from the last successful `loadCodeAssist`. The
 * scheduler runs `discoverCredentials` immediately before every fetch, so a
 * failed tier read falls back to the previous answer rather than dropping the
 * plan label off the card for one cycle.
 */
let cachedPlan: string | null = null;
let cachedProject: string | null = null;

/** Clears the cached tier. Called when the account changes. */
export function clearGeminiCache(): void {
  cachedPlan = null;
  cachedProject = null;
}

function headers(token: string): Record<string, string> {
  return { ...CLIENT_HEADERS, Authorization: `Bearer ${token}` };
}

async function loadTier(token: string): Promise<void> {
  try {
    const body = await httpPost({
      url: LOAD_URL,
      headers: headers(token),
      body: JSON.stringify({ metadata: { pluginType: "GEMINI" } }),
    });
    const parsed = parseJson(body, "loadCodeAssist");
    cachedPlan = planFromTier(parsed) ?? cachedPlan;
    cachedProject = projectFromLoad(parsed) ?? cachedProject;
  } catch (error) {
    // The tier is a label. Losing it must not cost the quota read, which is
    // the thing the card is actually for.
    log.debug("could not read the Code Assist tier", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

export const geminiProvider: UsageProvider = {
  id: "gemini",
  displayName: "Gemini",
  defaultIntervalSec: DEFAULT_INTERVAL_SEC,

  async discoverCredentials(): Promise<Credential | null> {
    const home = os.homedir();
    const found = await discoverGeminiCredentials({
      credsFile: credsFile(process.env, home),
      accountsFile: accountsFile(process.env, home),
    });
    if (found === null) {
      clearGeminiCache();
      return null;
    }

    const { credentials } = found;
    if (!credentials.scopes.includes(REQUIRED_SCOPE)) {
      log.debug("the stored token is not scoped for Code Assist", {
        source: found.source,
      });
      return null;
    }

    log.debug("found a Gemini CLI sign-in", { source: found.source });

    return {
      providerId: "gemini",
      kind: "bearer",
      secret: credentials.accessToken,
      expiresAt:
        credentials.expiryDate === null
          ? null
          : new Date(credentials.expiryDate).toISOString(),
      accountLabel: found.email ?? undefined,
    };
  },

  async fetchUsage(cred: Credential): Promise<ProviderUsage> {
    if (cred.kind !== "bearer") {
      throw new ProviderError(
        "auth",
        "The Gemini provider needs the CLI's Google token",
      );
    }

    // Google's tokens last about an hour and nothing here renews them, so an
    // aged-out token is named as such instead of being spent on a 401 the
    // scheduler would then back off from.
    const expiryDate =
      cred.expiresAt === null ? null : Date.parse(cred.expiresAt);
    const stored = {
      accessToken: cred.secret,
      refreshToken: null,
      expiryDate: Number.isNaN(expiryDate) ? null : expiryDate,
      scopes: [REQUIRED_SCOPE],
    };
    if (!isUsable(stored)) {
      throw new ProviderError(
        "auth",
        "The Gemini CLI's token has expired. Run gemini once to renew it.",
      );
    }

    await loadTier(cred.secret);

    const body = await httpPost({
      url: QUOTA_URL,
      headers: headers(cred.secret),
      body: JSON.stringify(
        cachedProject === null
          ? {}
          : { cloudaicompanionProject: cachedProject },
      ),
    });
    log.debug("quota response received", { bytes: body.length });

    return normalizeGeminiQuota(parseJson(body, "retrieveUserQuota"), {
      accountLabel: cred.accountLabel ?? cachedProject ?? "Gemini",
      plan: cachedPlan,
      fetchedAt: new Date().toISOString(),
    });
  },
};
