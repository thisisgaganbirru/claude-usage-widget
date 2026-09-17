/**
 * claude.ai provider.
 *
 * Credential: the session cookie captured by the sign-in window and kept in
 * the OS keychain (P1a). Data source: `/api/organizations/{id}/usage`, which is
 * what the claude.ai web app itself calls.
 *
 * Headers, per ADR-0003: this credential is a web session cookie, so the
 * request carries the headers the web app sends with it and nothing else. The
 * list lives here, in the provider folder, so it is auditable in one place.
 */
import { SessionManager } from "@main/auth/session-manager";
import { createLogger } from "@main/logging/logger";
import type { ProviderUsage } from "@shared/usage";
import { httpGet } from "../http";
import { parseJson } from "../schema";
import { ProviderError, type Credential, type UsageProvider } from "../types";
import { normalizeClaudeUsage, parseOrganizations } from "./normalize";

const log = createLogger("providers/claude");

const ORGANIZATIONS_URL = "https://claude.ai/api/organizations";

/**
 * The headers this provider sends, listed here per ADR-0003 so they are
 * auditable in one place. The credential is a claude.ai web session cookie, so
 * these are the web app's own headers.
 *
 * The desktop-Chrome User-Agent is carried over from 1.0 unchanged. ADR-0003
 * is still Proposed and names this string as a known limitation to remove once
 * the embedded-login decision is settled; changing what the vendor sees is
 * that decision's job, not this refactor's.
 */
const WEB_APP_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  Referer: "https://claude.ai/",
  "Anthropic-Client-Platform": "web_claude_ai",
};

/**
 * Org id and name, resolved once per process. The id is not a secret, but it
 * is account-identifying, so it is never logged.
 */
interface CachedOrg {
  uuid: string;
  name: string | null;
}

let cachedOrg: CachedOrg | null = null;

export function clearClaudeOrgCache(): void {
  cachedOrg = null;
}

function requestHeaders(cookie: string): Record<string, string> {
  return { ...WEB_APP_HEADERS, Cookie: cookie };
}

async function resolveOrg(cookie: string): Promise<CachedOrg> {
  if (cachedOrg !== null) return cachedOrg;
  const body = await httpGet({
    url: ORGANIZATIONS_URL,
    headers: requestHeaders(cookie),
  });
  const org = parseOrganizations(parseJson(body, "organizations"));
  cachedOrg = org;
  return org;
}

export const claudeProvider: UsageProvider = {
  id: "claude",
  displayName: "Claude",
  defaultIntervalSec: 60,

  async discoverCredentials(): Promise<Credential | null> {
    const cookie = SessionManager.getSessionCookie("claude");
    if (cookie === null || cookie.length === 0) return null;
    const account = SessionManager.getActiveAccount("claude");
    return {
      providerId: "claude",
      kind: "cookie",
      secret: cookie,
      // The session store owns expiry and returns null once it has passed, so
      // a credential that reaches here is live by definition.
      expiresAt: null,
      accountLabel: account?.displayName,
    };
  },

  async fetchUsage(cred: Credential): Promise<ProviderUsage> {
    if (cred.kind !== "cookie") {
      throw new ProviderError(
        "auth",
        "The Claude provider needs a session cookie",
      );
    }

    const org = await resolveOrg(cred.secret);
    const url = `${ORGANIZATIONS_URL}/${org.uuid}/usage`;
    const body = await httpGet({ url, headers: requestHeaders(cred.secret) });
    log.debug("usage response received", { bytes: body.length });

    return normalizeClaudeUsage(parseJson(body, "usage"), {
      accountLabel: org.name ?? cred.accountLabel ?? "Claude account",
      fetchedAt: new Date().toISOString(),
    });
  },

  async logout(): Promise<void> {
    clearClaudeOrgCache();
  },
};
