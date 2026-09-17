/**
 * Claude provider, over two transports.
 *
 * The preferred one is Claude Code's own OAuth token, read from the CLI's
 * store: someone who works in the terminal gets a Claude card without signing
 * into anything, and that credential is the one already scoped for this exact
 * read. The browser session cookie is the fallback for people who do not have
 * Claude Code installed.
 *
 * Both transports return the same response shape, so `normalizeClaudeUsage`
 * handles both and the card cannot tell which one produced it.
 *
 * Headers, per ADR-0003: the cookie path sends what the web app sends, and the
 * OAuth path sends what Claude Code sends. Each list lives beside the
 * transport that uses it. The desktop-Chrome User-Agent below is carried over
 * from 1.0 unchanged; ADR-0003 is still Proposed and names it as a known
 * limitation to remove once the embedded-login decision is settled.
 */
import * as os from "os";
import { SessionManager } from "@main/auth/session-manager";
import { createLogger } from "@main/logging/logger";
import type { ProviderUsage } from "@shared/usage";
import { httpGet } from "../http";
import { parseJson } from "../schema";
import { ProviderError, type Credential, type UsageProvider } from "../types";
import {
  discoverClaudeCodeCredentials,
  type ClaudeCodeCredentials,
  type ClaudeCodeSource,
} from "./code-credentials";
import {
  normalizeClaudeUsage,
  parseClaudeAccount,
  parseOauthProfile,
  parseOrganizations,
  planFromTier,
} from "./normalize";
import {
  cacheUsage,
  cachedUsage,
  clearUsageCache,
  fetchOauthProfile,
  fetchOauthUsage,
} from "./oauth";

const log = createLogger("providers/claude");

const ORGANIZATIONS_URL = "https://claude.ai/api/organizations";
const ACCOUNT_URL = "https://claude.ai/api/account";

/**
 * The headers the cookie transport sends, listed here per ADR-0003 so they are
 * auditable in one place. The credential is a claude.ai web session cookie, so
 * these are the web app's own headers.
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
let cachedWebPlan: string | null = null;
let cachedOauthLabel: string | null = null;

/**
 * The plan hints the last discovered Claude Code credential carried. They are
 * not secret and do not belong on the `Credential`, which exists to carry a
 * token; discovery runs immediately before every fetch, so this is always the
 * current credential's.
 */
let codePlanHint: string | null = null;

export function clearClaudeOrgCache(): void {
  cachedOrg = null;
  cachedWebPlan = null;
  cachedOauthLabel = null;
  codePlanHint = null;
  clearUsageCache();
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

/**
 * The plan, from `/api/account`. Resolved once per process: it changes when a
 * subscription changes, not between polls, and this endpoint is one more
 * request against a host that rate-limits. A failure costs the label only.
 */
async function resolveWebPlan(
  cookie: string,
  orgUuid: string,
): Promise<string | null> {
  if (cachedWebPlan !== null) return cachedWebPlan;
  try {
    const body = await httpGet({
      url: ACCOUNT_URL,
      headers: requestHeaders(cookie),
    });
    const account = parseClaudeAccount(parseJson(body, "account"), orgUuid);
    cachedWebPlan = account.plan;
    return account.plan;
  } catch {
    log.debug("account lookup failed, continuing without a plan label");
    return null;
  }
}

/** The account label, from `/api/oauth/profile`. Same reasoning as the plan. */
async function resolveOauthLabel(token: string): Promise<string | null> {
  if (cachedOauthLabel !== null) return cachedOauthLabel;
  try {
    const profile = parseOauthProfile(
      parseJson(await fetchOauthProfile(token), "profile"),
    );
    cachedOauthLabel = profile.email;
    return profile.email;
  } catch {
    log.debug("profile lookup failed, continuing without an account label");
    return null;
  }
}

function planHintFor(credentials: ClaudeCodeCredentials): string | null {
  return (
    planFromTier(credentials.rateLimitTier) ??
    planFromTier(credentials.subscriptionType)
  );
}

async function discoverFromClaudeCode(): Promise<{
  credential: Credential;
  source: ClaudeCodeSource;
} | null> {
  const found = await discoverClaudeCodeCredentials({
    env: process.env,
    homeDir: os.homedir(),
    platform: process.platform,
  });
  if (found === null) return null;

  codePlanHint = planHintFor(found.credentials);
  return {
    source: found.source,
    credential: {
      providerId: "claude",
      kind: "bearer",
      secret: found.credentials.accessToken,
      expiresAt:
        found.credentials.expiresAt === null
          ? null
          : new Date(found.credentials.expiresAt).toISOString(),
    },
  };
}

async function fetchOverOauth(token: string): Promise<ProviderUsage> {
  // Ahead of every request: this endpoint answers a poll loop with an
  // hour-long lockout, and a fifteen-minute-old reading is worth far more than
  // one that is current until the vendor stops answering at all.
  const fromCache = cachedUsage();
  if (fromCache !== null) {
    log.debug("serving the cached usage snapshot");
    return fromCache;
  }

  const label = await resolveOauthLabel(token);
  const body = await fetchOauthUsage(token);
  log.debug("oauth usage response received", { bytes: body.length });

  const usage = normalizeClaudeUsage(parseJson(body, "usage"), {
    accountLabel: label ?? "Claude Code",
    fetchedAt: new Date().toISOString(),
    plan: codePlanHint,
  });
  cacheUsage(usage);
  return usage;
}

async function fetchOverCookie(cookie: string): Promise<ProviderUsage> {
  const org = await resolveOrg(cookie);
  const plan = await resolveWebPlan(cookie, org.uuid);
  const url = `${ORGANIZATIONS_URL}/${org.uuid}/usage`;
  const body = await httpGet({ url, headers: requestHeaders(cookie) });
  log.debug("usage response received", { bytes: body.length });

  return normalizeClaudeUsage(parseJson(body, "usage"), {
    accountLabel: org.name ?? "Claude account",
    fetchedAt: new Date().toISOString(),
    plan,
  });
}

export const claudeProvider: UsageProvider = {
  id: "claude",
  displayName: "Claude",
  defaultIntervalSec: 60,

  /**
   * Claude Code's token first, the browser cookie second. The token is already
   * scoped for this read and needs no sign-in window, so a machine that has
   * both should use the one that costs the user nothing.
   */
  async discoverCredentials(): Promise<Credential | null> {
    const fromClaudeCode = await discoverFromClaudeCode();
    if (fromClaudeCode !== null) {
      log.debug("using the Claude Code credential", {
        source: fromClaudeCode.source,
      });
      return fromClaudeCode.credential;
    }

    codePlanHint = null;
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
    if (cred.kind === "bearer") return fetchOverOauth(cred.secret);
    if (cred.kind === "cookie") return fetchOverCookie(cred.secret);
    throw new ProviderError(
      "auth",
      "The Claude provider needs a session cookie or an OAuth token",
    );
  },

  async logout(): Promise<void> {
    clearClaudeOrgCache();
  },
};
