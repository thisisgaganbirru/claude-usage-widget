import { afterEach, describe, expect, it } from "vitest";
import type { ProviderUsage } from "@shared/usage";
import {
  cacheUsage,
  cachedUsage,
  clearUsageCache,
  oauthHeaders,
  OAUTH_BETA,
  SNAPSHOT_CACHE_MS,
} from "../oauth";

const NOW = Date.parse("2026-03-10T00:00:00.000Z");

const usage: ProviderUsage = {
  providerId: "claude",
  accountLabel: "ada@example.com",
  plan: "Max 20x",
  windows: [
    { id: "session", label: "5h session", usedPercent: 12, resetsAt: null },
  ],
  fetchedAt: "2026-03-10T00:00:00.000Z",
};

afterEach(() => {
  clearUsageCache();
});

describe("oauthHeaders", () => {
  it("sends the beta header the endpoint requires", () => {
    expect(oauthHeaders("token-1")["anthropic-beta"]).toBe(OAUTH_BETA);
  });

  it("presents the token as a bearer", () => {
    expect(oauthHeaders("token-1").Authorization).toBe("Bearer token-1");
  });

  it("announces itself as the client the token belongs to", () => {
    expect(oauthHeaders("token-1")["User-Agent"]).toMatch(/^claude-code\//);
  });
});

describe("the usage snapshot cache", () => {
  it("has nothing to serve before a reading", () => {
    expect(cachedUsage(NOW)).toBeNull();
  });

  it("serves a reading inside the cache window", () => {
    cacheUsage(usage, NOW);

    expect(cachedUsage(NOW + SNAPSHOT_CACHE_MS - 1)).toBe(usage);
  });

  it("stops serving once the window has passed", () => {
    cacheUsage(usage, NOW);

    expect(cachedUsage(NOW + SNAPSHOT_CACHE_MS)).toBeNull();
  });

  it("drops the reading on a sign-out", () => {
    cacheUsage(usage, NOW);
    clearUsageCache();

    expect(cachedUsage(NOW)).toBeNull();
  });
});
