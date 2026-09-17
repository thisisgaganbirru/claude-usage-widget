import { describe, expect, it } from "vitest";
import {
  detectPlan,
  normalizeClaudeUsage,
  parseOrganizations,
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
