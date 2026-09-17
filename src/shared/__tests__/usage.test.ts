import { describe, expect, it } from "vitest";
import {
  clampPercent,
  worstAcrossProviders,
  worstWindow,
  type ProviderId,
  type ProviderState,
  type ProviderUsage,
  type UsageWindow,
} from "../usage";

const FETCHED_AT = "2026-09-17T00:00:00.000Z";

function window(id: string, usedPercent: number, model?: string): UsageWindow {
  return {
    id,
    label: id,
    usedPercent,
    resetsAt: null,
    ...(model ? { model } : {}),
  };
}

function usage(providerId: ProviderId, windows: UsageWindow[]): ProviderUsage {
  return {
    providerId,
    accountLabel: providerId,
    plan: null,
    windows,
    fetchedAt: FETCHED_AT,
  };
}

function ok(
  providerId: ProviderId,
  windows: UsageWindow[],
  staleSince?: string,
): ProviderState {
  return {
    kind: "ok",
    usage: usage(providerId, windows),
    ...(staleSince ? { staleSince } : {}),
  };
}

describe("clampPercent", () => {
  it("keeps a percentage inside 0..100", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(42.5)).toBe(42.5);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});

describe("worstWindow", () => {
  it("takes the highest top-level window", () => {
    expect(worstWindow([window("session", 20), window("weekly", 80)])?.id).toBe(
      "weekly",
    );
  });

  it("prefers a total over a per-model breakdown of the same thing", () => {
    expect(
      worstWindow([window("weekly", 40), window("opus", 95, "opus")])?.id,
    ).toBe("weekly");
  });

  it("falls back to per-model windows when there is no total", () => {
    // Gemini reports one allowance per model and no overall figure. Skipping
    // these would render "no usage reported" at 90% used.
    expect(
      worstWindow([
        window("gemini-2.5-flash", 30, "gemini-2.5-flash"),
        window("gemini-2.5-pro", 90, "gemini-2.5-pro"),
      ])?.id,
    ).toBe("gemini-2.5-pro");
  });

  it("returns null when there are no windows at all", () => {
    expect(worstWindow([])).toBeNull();
  });
});

describe("worstAcrossProviders", () => {
  it("names the provider closest to a wall", () => {
    const found = worstAcrossProviders([
      { providerId: "claude", state: ok("claude", [window("weekly", 40)]) },
      { providerId: "cursor", state: ok("cursor", [window("individual", 85)]) },
      { providerId: "codex", state: ok("codex", [window("weekly", 60)]) },
    ]);

    expect(found?.providerId).toBe("cursor");
    expect(found?.window.usedPercent).toBe(85);
    expect(found?.stale).toBe(false);
  });

  it("keeps the first provider when two report the same percentage", () => {
    const found = worstAcrossProviders([
      { providerId: "claude", state: ok("claude", [window("weekly", 50)]) },
      { providerId: "codex", state: ok("codex", [window("weekly", 50)]) },
    ]);

    expect(found?.providerId).toBe("claude");
  });

  it("marks the answer stale when the reporting provider's data is", () => {
    const found = worstAcrossProviders([
      {
        providerId: "claude",
        state: ok("claude", [window("weekly", 70)], FETCHED_AT),
      },
    ]);

    expect(found?.stale).toBe(true);
  });

  it("ignores providers that are not reporting a number", () => {
    // A provider we cannot see must not contribute a zero: that would drag the
    // icon green and claim there is plenty left.
    const found = worstAcrossProviders([
      { providerId: "claude", state: ok("claude", [window("weekly", 70)]) },
      { providerId: "copilot", state: { kind: "not-detected" } },
      { providerId: "gemini", state: { kind: "needs-auth", hint: "sign in" } },
      {
        providerId: "cursor",
        state: {
          kind: "error",
          code: "network",
          message: "down",
          retryAt: FETCHED_AT,
        },
      },
    ]);

    expect(found?.providerId).toBe("claude");
    expect(found?.window.usedPercent).toBe(70);
  });

  it("returns null when nothing is reporting", () => {
    expect(worstAcrossProviders([])).toBeNull();
    expect(
      worstAcrossProviders([
        { providerId: "claude", state: { kind: "not-detected" } },
      ]),
    ).toBeNull();
  });

  it("returns null when a provider is fine but metering nothing", () => {
    expect(
      worstAcrossProviders([
        { providerId: "copilot", state: ok("copilot", []) },
      ]),
    ).toBeNull();
  });
});
