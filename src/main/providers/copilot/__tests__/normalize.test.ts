import { describe, expect, it } from "vitest";
import { ProviderError } from "../../types";
import {
  isPlaceholder,
  labelForKey,
  normalizeCopilotUsage,
  readNumber,
  readResetDate,
} from "../normalize";

const FETCHED_AT = "2026-09-17T00:00:00.000Z";
const options = { accountLabel: "octocat", fetchedAt: FETCHED_AT };

function snapshot(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    entitlement: 300,
    remaining: 271.5,
    percent_remaining: 90.5,
    unlimited: false,
    ...overrides,
  };
}

describe("readNumber", () => {
  it("reads a number stated either way", () => {
    expect(readNumber(12.5)).toBe(12.5);
    expect(readNumber("12.5")).toBe(12.5);
  });

  it("returns null for anything that is not one", () => {
    expect(readNumber(null)).toBeNull();
    expect(readNumber("")).toBeNull();
    expect(readNumber("lots")).toBeNull();
    expect(readNumber(Number.NaN)).toBeNull();
  });
});

describe("isPlaceholder", () => {
  it("accepts a quota that is actually metered", () => {
    expect(isPlaceholder(snapshot())).toBe(false);
  });

  it("drops the zero-entitlement row Business seats report", () => {
    expect(isPlaceholder(snapshot({ entitlement: 0, remaining: 0 }))).toBe(
      true,
    );
  });

  it("drops it even when it claims to be fully remaining", () => {
    expect(
      isPlaceholder(
        snapshot({ entitlement: 0, remaining: 0, percent_remaining: 100 }),
      ),
    ).toBe(true);
  });

  it("drops an unlimited quota, which has no percentage to show", () => {
    expect(isPlaceholder(snapshot({ unlimited: true }))).toBe(true);
  });
});

describe("readResetDate", () => {
  it("reads a plain date as UTC midnight", () => {
    expect(readResetDate("2026-10-01")).toBe("2026-10-01T00:00:00.000Z");
  });

  it("reads a full timestamp too", () => {
    expect(readResetDate("2026-10-01T12:00:00Z")).toBe(
      "2026-10-01T12:00:00.000Z",
    );
  });

  it("returns null for anything unreadable", () => {
    expect(readResetDate(null)).toBeNull();
    expect(readResetDate("next month")).toBeNull();
  });
});

describe("labelForKey", () => {
  it("makes a readable label out of a snapshot key", () => {
    expect(labelForKey("premium_interactions")).toBe("Premium interactions");
    expect(labelForKey("agent-mode")).toBe("Agent mode");
  });
});

describe("normalizeCopilotUsage", () => {
  it("reads the three known quotas in display order", () => {
    const usage = normalizeCopilotUsage(
      {
        copilot_plan: "individual",
        quota_reset_date: "2026-10-01",
        quota_snapshots: {
          completions: snapshot({ percent_remaining: 40 }),
          chat: snapshot({ percent_remaining: 75 }),
          premium_interactions: snapshot({ percent_remaining: 90.5 }),
        },
      },
      options,
    );

    expect(usage.providerId).toBe("copilot");
    expect(usage.plan).toBe("Individual");
    expect(usage.windows.map((window) => window.id)).toEqual([
      "premium_interactions",
      "chat",
      "completions",
    ]);
    expect(usage.windows[0].usedPercent).toBe(9.5);
    expect(usage.windows[0].label).toBe("Premium requests");
    expect(usage.windows[0].resetsAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("derives the percentage when the response states only counts", () => {
    const usage = normalizeCopilotUsage(
      {
        quota_snapshots: {
          chat: { entitlement: 200, remaining: 50 },
        },
      },
      options,
    );

    expect(usage.windows[0].usedPercent).toBe(75);
  });

  it("reads counts stated as strings", () => {
    const usage = normalizeCopilotUsage(
      {
        quota_snapshots: {
          chat: { entitlement: "200", remaining: "50" },
        },
      },
      options,
    );

    expect(usage.windows[0].usedPercent).toBe(75);
  });

  it("keeps a quota key it has never seen before", () => {
    const usage = normalizeCopilotUsage(
      {
        quota_snapshots: {
          agent_sessions: snapshot({ percent_remaining: 20 }),
        },
      },
      options,
    );

    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0].label).toBe("Agent sessions");
    expect(usage.windows[0].usedPercent).toBe(80);
  });

  it("drops placeholder rows rather than painting them green", () => {
    const usage = normalizeCopilotUsage(
      {
        quota_snapshots: {
          premium_interactions: snapshot({ percent_remaining: 10 }),
          chat: { entitlement: 0, remaining: 0, percent_remaining: 100 },
        },
      },
      options,
    );

    expect(usage.windows.map((window) => window.id)).toEqual([
      "premium_interactions",
    ]);
  });

  it("falls back to the legacy quotas, which count what is left", () => {
    const usage = normalizeCopilotUsage(
      {
        quota_reset_date: "2026-10-01",
        monthly_quotas: { completions: 2000, chat: 500 },
        limited_user_quotas: { completions: 1800, chat: 250 },
      },
      options,
    );

    expect(usage.windows).toHaveLength(2);
    expect(usage.windows[0]).toMatchObject({
      id: "completions",
      usedPercent: 10,
    });
    expect(usage.windows[1].usedPercent).toBe(50);
  });

  it("reports no windows for a seat with nothing metered", () => {
    const usage = normalizeCopilotUsage(
      { quota_snapshots: { chat: { unlimited: true } } },
      options,
    );

    expect(usage.windows).toEqual([]);
    expect(usage.accountLabel).toBe("octocat");
  });

  it("refuses a response that is not an object", () => {
    expect(() => normalizeCopilotUsage("nope", options)).toThrow(ProviderError);
  });
});
