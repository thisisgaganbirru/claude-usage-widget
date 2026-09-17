/**
 * The usage read Claude Code itself performs.
 *
 * Same response shape as the web endpoint, different transport: a bearer token
 * instead of a session cookie, and one required beta header.
 *
 * Headers are listed here per ADR-0003. The User-Agent claims to be Claude
 * Code because this request *is* the request Claude Code makes, with Claude
 * Code's own token; announcing a different client on an endpoint that only
 * that client calls is the more likely way to get filtered.
 *
 * The endpoint rate-limits hard. A single call after a quiet period has been
 * answered with an hour-long `Retry-After`, so a successful reading is cached
 * for fifteen minutes here rather than in the scheduler: the scheduler owns
 * cadence in general, but this ceiling is a fact about this one endpoint and
 * belongs next to it.
 */
import type { ProviderUsage } from "@shared/usage";
import { httpGet } from "../http";

export const OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const OAUTH_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";

/** Required. Without it the endpoint refuses the token. */
export const OAUTH_BETA = "oauth-2025-04-20";

/**
 * The client this request belongs to. There is no reliable way to read the
 * installed CLI's version from here, so the string is a constant and ADR-0003
 * records it as one.
 */
export const OAUTH_USER_AGENT = "claude-code/2.1.0";

/** How long a successful reading stands in for the next one. */
export const SNAPSHOT_CACHE_MS = 15 * 60 * 1000;

export function oauthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "anthropic-beta": OAUTH_BETA,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": OAUTH_USER_AGENT,
  };
}

export function fetchOauthUsage(token: string): Promise<string> {
  return httpGet({ url: OAUTH_USAGE_URL, headers: oauthHeaders(token) });
}

export function fetchOauthProfile(token: string): Promise<string> {
  return httpGet({ url: OAUTH_PROFILE_URL, headers: oauthHeaders(token) });
}

interface CachedSnapshot {
  usage: ProviderUsage;
  at: number;
}

let cached: CachedSnapshot | null = null;

/** The last reading, while it is inside the cache window. */
export function cachedUsage(now: number = Date.now()): ProviderUsage | null {
  if (cached === null) return null;
  if (now - cached.at >= SNAPSHOT_CACHE_MS) return null;
  return cached.usage;
}

export function cacheUsage(
  usage: ProviderUsage,
  now: number = Date.now(),
): void {
  cached = { usage, at: now };
}

/** Drops the cache, so a sign-out cannot leave one account's numbers on screen. */
export function clearUsageCache(): void {
  cached = null;
}
