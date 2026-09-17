import { describe, expect, it } from "vitest";
import {
  detectPlan,
  normalizeClaudeUsage,
  parseClaudeAccount,
  parseOauthProfile,
  parseOrganizations,
  parseScopedLimits,
  planFromTier,
} from "../normalize";
import { ProviderError } from "../../types";

const FETCHED_AT = "2026-03-10T00:00:00.000Z";

const options = { accountLabel: "Acme", fetchedAt: FETCHED_AT };

function goodResponse(): Record<string, unknown> {
  return {
    five_hour: { utilization: 42, resets_at: "2026-03-10T03:00:00Z" },
    seven_day: { utilization: 20, resets_at: "2026-03-13T08:00:00Z" },
    seven_day_opus: { utilization: 5, resets_at: "2026-03-13T08:00:00Z" },
    seven_day_sonnet: null,
    extra_usage: { is_enabled: false },
  };
}

describe("normalizeClaudeUsage", () => {
  it("maps the documented response onto windows", () => {
    const usage = normalizeClaudeUsage(goodResponse(), options);

    expect(usage.providerId).toBe("claude");
    expect(usage.accountLabel).toBe("Acme");
    expect(usage.plan).toBe("Pro");
    expect(usage.fetchedAt).toBe(FETCHED_AT);
    expect(usage.windows.map((window) => window.id)).toEqual([
      "session",
      "weekly",
      "weekly-opus",
    ]);

    const session = usage.windows[0];
    expect(session.usedPercent).toBe(42);
    expect(session.resetsAt).toBe("2026-03-10T03:00:00.000Z");
    expect(session.windowMinutes).toBe(300);
    expect(session.model).toBeUndefined();

    expect(usage.windows[2].model).toBe("opus");
  });

  it("keeps a session window whose reset time has not been set", () => {
    const response = goodResponse();
    response.five_hour = { utilization: 0, resets_at: null };

    const usage = normalizeClaudeUsage(response, options);

    expect(usage.windows[0].resetsAt).toBeNull();
    expect(usage.windows[0].usedPercent).toBe(0);
  });

  it("works for an account with no session window yet", () => {
    const response = goodResponse();
    delete response.five_hour;

    const usage = normalizeClaudeUsage(response, options);

    expect(usage.windows.map((window) => window.id)).toEqual([
      "weekly",
      "weekly-opus",
    ]);
  });

  it("clamps a utilization the vendor reports outside 0..100", () => {
    const response = goodResponse();
    response.five_hour = { utilization: 140, resets_at: null };
    response.seven_day = { utilization: -3, resets_at: null };

    const usage = normalizeClaudeUsage(response, options);

    expect(usage.windows[0].usedPercent).toBe(100);
    expect(usage.windows[1].usedPercent).toBe(0);
  });

  it("rejects a response with neither window rather than reporting zero", () => {
    expect(() => normalizeClaudeUsage({ extra_usage: {} }, options)).toThrow(
      ProviderError,
    );
  });

  it("rejects a retyped utilization instead of coercing it", () => {
    const response = goodResponse();
    response.five_hour = { utilization: "42", resets_at: null };

    expect(() => normalizeClaudeUsage(response, options)).toThrowError(
      /five_hour\.utilization/,
    );
  });

  it("rejects an unparseable reset timestamp", () => {
    const response = goodResponse();
    response.five_hour = { utilization: 1, resets_at: "not-a-date" };

    expect(() => normalizeClaudeUsage(response, options)).toThrowError(
      /five_hour\.resets_at/,
    );
  });

  it("reports a schema error, not a crash, on an empty response", () => {
    const error = (() => {
      try {
        normalizeClaudeUsage({}, options);
        return null;
      } catch (thrown) {
        return thrown as ProviderError;
      }
    })();

    expect(error?.kind).toBe("schema");
  });

  it("rejects a response that is not an object", () => {
    expect(() => normalizeClaudeUsage([], options)).toThrow(ProviderError);
    expect(() => normalizeClaudeUsage(null, options)).toThrow(ProviderError);
  });
});

describe("detectPlan", () => {
  it("reads Pro+ from enabled extra usage", () => {
    expect(detectPlan({ extra_usage: { is_enabled: true } })).toBe("Pro+");
  });

  it("reads Pro from disabled extra usage", () => {
    expect(detectPlan({ extra_usage: { is_enabled: false } })).toBe("Pro");
  });

  it("returns null when the vendor says nothing about the plan", () => {
    expect(detectPlan({})).toBeNull();
    expect(detectPlan({ extra_usage: null })).toBeNull();
    expect(detectPlan({ extra_usage: {} })).toBeNull();
  });
});

describe("parseOrganizations", () => {
  it("reads the first organization and strips the personal-account suffix", () => {
    const org = parseOrganizations([
      { uuid: "org-1", name: "Ada's Organization" },
      { uuid: "org-2", name: "Second" },
    ]);

    expect(org).toEqual({ uuid: "org-1", name: "Ada" });
  });

  it("accepts a bare object as well as a list", () => {
    expect(parseOrganizations({ uuid: "org-1", name: "Acme" })).toEqual({
      uuid: "org-1",
      name: "Acme",
    });
  });

  it("returns a null name when the org has none", () => {
    expect(parseOrganizations([{ uuid: "org-1" }]).name).toBeNull();
    expect(parseOrganizations([{ uuid: "org-1", name: "  " }]).name).toBeNull();
  });

  it("rejects a response with no usable organization", () => {
    expect(() => parseOrganizations([])).toThrow(ProviderError);
    expect(() => parseOrganizations([{ name: "no uuid" }])).toThrow(
      ProviderError,
    );
    expect(() => parseOrganizations([{ uuid: "" }])).toThrow(ProviderError);
  });
});

describe("parseScopedLimits", () => {
  function scopedRow(
    id: string,
    displayName: string,
    percent: number,
  ): Record<string, unknown> {
    return {
      kind: "weekly_scoped",
      group: "weekly",
      percent,
      is_active: true,
      resets_at: "2026-03-13T08:00:00Z",
      scope: { model: { id, display_name: displayName } },
    };
  }

  it("reads a model-scoped weekly row", () => {
    const windows = parseScopedLimits({
      limits: [scopedRow("fable-5", "Fable 5", 12.5)],
    });

    expect(windows).toEqual([
      {
        id: "weekly-fable-5",
        label: "7d Fable 5",
        usedPercent: 12.5,
        resetsAt: "2026-03-13T08:00:00.000Z",
        windowMinutes: 10080,
        model: "fable-5",
      },
    ]);
  });

  it("drops the all-models row, which duplicates the weekly bar", () => {
    const windows = parseScopedLimits({
      limits: [scopedRow("all-models", "All models", 40)],
    });

    expect(windows).toEqual([]);
  });

  it("ignores rows that are not model-scoped weeklies", () => {
    const windows = parseScopedLimits({
      limits: [
        { kind: "session", group: "session", percent: 10 },
        { ...scopedRow("fable-5", "Fable 5", 1), group: "monthly" },
        { ...scopedRow("fable-5", "Fable 5", 1), is_active: false },
      ],
    });

    expect(windows).toEqual([]);
  });

  it("keys on the model id and skips a repeat of the same model", () => {
    const windows = parseScopedLimits({
      limits: [
        scopedRow("fable-5", "Fable 5", 12),
        scopedRow("fable-5", "Fable 5", 30),
      ],
    });

    expect(windows).toHaveLength(1);
    expect(windows[0].usedPercent).toBe(12);
  });

  it("falls back to the display name when a row carries no id", () => {
    const windows = parseScopedLimits({
      limits: [
        {
          kind: "weekly_scoped",
          group: "weekly",
          percent: 3,
          scope: { model: { display_name: "Fable 5" } },
        },
      ],
    });

    expect(windows[0].id).toBe("weekly-fable-5");
    expect(windows[0].model).toBe("fable-5");
  });

  it("returns nothing when there is no limits array", () => {
    expect(parseScopedLimits({})).toEqual([]);
    expect(parseScopedLimits({ limits: "nope" })).toEqual([]);
  });

  it("skips a malformed row rather than losing the rest", () => {
    const windows = parseScopedLimits({
      limits: [
        { kind: "weekly_scoped", group: "weekly", percent: "12" },
        null,
        scopedRow("fable-5", "Fable 5", 12),
      ],
    });

    expect(windows).toHaveLength(1);
  });
});

describe("normalizeClaudeUsage with limits[]", () => {
  it("prefers a limits[] row over the legacy field for the same model", () => {
    const usage = normalizeClaudeUsage(
      {
        ...goodResponse(),
        seven_day_opus: { utilization: 5 },
        limits: [
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 44,
            scope: { model: { id: "opus", display_name: "Opus" } },
          },
        ],
      },
      options,
    );

    const opus = usage.windows.filter((window) => window.model === "opus");
    expect(opus).toHaveLength(1);
    expect(opus[0].usedPercent).toBe(44);
  });

  it("takes the plan the caller resolved over the extra_usage guess", () => {
    const usage = normalizeClaudeUsage(goodResponse(), {
      ...options,
      plan: "Max 20x",
    });

    expect(usage.plan).toBe("Max 20x");
  });
});

describe("planFromTier", () => {
  it("reads the multiplier out of a Max tier", () => {
    expect(planFromTier("default_claude_max_20x")).toBe("Max 20x");
    expect(planFromTier("default_claude_max_5x")).toBe("Max 5x");
    expect(planFromTier("claude_max")).toBe("Max");
  });

  it("names the other tiers", () => {
    expect(planFromTier("default_claude_pro")).toBe("Pro");
    expect(planFromTier("team_tier")).toBe("Team");
    expect(planFromTier("enterprise_thing")).toBe("Enterprise");
  });

  it("returns null for a tier it cannot name", () => {
    expect(planFromTier(null)).toBeNull();
    expect(planFromTier("default_something_else")).toBeNull();
  });
});

describe("parseClaudeAccount", () => {
  function account(org: Record<string, unknown>, seatTier?: string): unknown {
    return {
      email_address: "ada@example.com",
      memberships: [
        { ...(seatTier ? { seat_tier: seatTier } : {}), organization: org },
      ],
    };
  }

  it("reads the email and the plan from the matching membership", () => {
    const parsed = parseClaudeAccount(
      {
        email_address: "ada@example.com",
        memberships: [
          {
            organization: {
              uuid: "org-1",
              rate_limit_tier: "default_claude_pro",
            },
          },
          {
            organization: {
              uuid: "org-2",
              rate_limit_tier: "default_claude_max_20x",
            },
          },
        ],
      },
      "org-2",
    );

    expect(parsed).toEqual({ email: "ada@example.com", plan: "Max 20x" });
  });

  it("falls back to the first membership when none matches", () => {
    const parsed = parseClaudeAccount(
      account({ uuid: "org-1", rate_limit_tier: "default_claude_max_5x" }),
      "org-other",
    );

    expect(parsed.plan).toBe("Max 5x");
  });

  it("names a team plan from the seat tier", () => {
    const parsed = parseClaudeAccount(
      account({ uuid: "org-1" }, "team_standard"),
      "org-1",
    );

    expect(parsed.plan).toBe("Team Standard");
  });

  it("treats a Stripe subscription on a Claude tier as Pro", () => {
    const parsed = parseClaudeAccount(
      account({
        uuid: "org-1",
        rate_limit_tier: "default_claude_something",
        billing_type: "stripe_subscription",
      }),
      "org-1",
    );

    expect(parsed.plan).toBe("Pro");
  });

  it("reports no plan for a free account rather than guessing", () => {
    expect(
      parseClaudeAccount(account({ uuid: "org-1" }), "org-1").plan,
    ).toBeNull();
    expect(parseClaudeAccount(null)).toEqual({ email: null, plan: null });
    expect(parseClaudeAccount({ email_address: "a@b.c" })).toEqual({
      email: "a@b.c",
      plan: null,
    });
  });
});

describe("parseOauthProfile", () => {
  it("reads the email and org id", () => {
    expect(
      parseOauthProfile({
        account: { email_address: "ada@example.com" },
        organization: { uuid: "org-1" },
      }),
    ).toEqual({ email: "ada@example.com", orgUuid: "org-1" });
  });

  it("returns nulls rather than throwing on a shape it does not know", () => {
    expect(parseOauthProfile({})).toEqual({ email: null, orgUuid: null });
    expect(parseOauthProfile("nope")).toEqual({ email: null, orgUuid: null });
  });
});
