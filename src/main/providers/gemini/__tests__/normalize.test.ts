import { describe, expect, it } from "vitest";
import { ProviderError } from "../../types";
import {
  normalizeGeminiQuota,
  planFromTier,
  projectFromLoad,
} from "../normalize";

const FETCHED_AT = "2026-09-17T00:00:00.000Z";
const options = {
  accountLabel: "ada@example.com",
  plan: "Free tier",
  fetchedAt: FETCHED_AT,
};

describe("planFromTier", () => {
  it("reads the tier name", () => {
    expect(
      planFromTier({ currentTier: { id: "free-tier", name: "Free" } }),
    ).toBe("Free");
  });

  it("falls back to the id, made readable", () => {
    expect(planFromTier({ currentTier: { id: "standard-tier" } })).toBe(
      "Standard tier",
    );
  });

  it("returns null when there is no tier", () => {
    expect(planFromTier({})).toBeNull();
    expect(planFromTier(null)).toBeNull();
  });
});

describe("projectFromLoad", () => {
  it("reads the Cloud project", () => {
    expect(projectFromLoad({ cloudaicompanionProject: "proj-1" })).toBe(
      "proj-1",
    );
  });

  it("returns null when there is none", () => {
    expect(projectFromLoad({})).toBeNull();
  });
});

describe("normalizeGeminiQuota", () => {
  it("inverts the remaining fraction into a used percentage", () => {
    const usage = normalizeGeminiQuota(
      {
        userQuotas: [
          {
            model: "gemini-2.5-pro",
            remainingFraction: 0.25,
            resetTime: "2026-09-18T00:00:00Z",
          },
        ],
      },
      options,
    );

    expect(usage.providerId).toBe("gemini");
    expect(usage.plan).toBe("Free tier");
    expect(usage.windows).toEqual([
      {
        id: "gemini-2.5-pro",
        label: "gemini-2.5-pro",
        usedPercent: 75,
        resetsAt: "2026-09-18T00:00:00.000Z",
        model: "gemini-2.5-pro",
      },
    ]);
  });

  it("keeps the tighter bucket when a model is metered twice", () => {
    const usage = normalizeGeminiQuota(
      {
        userQuotas: [
          { model: "gemini-2.5-pro", remainingFraction: 0.8 },
          { model: "gemini-2.5-pro", remainingFraction: 0.1 },
        ],
      },
      options,
    );

    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0].usedPercent).toBeCloseTo(90);
  });

  it("reads the other spellings the endpoint has used", () => {
    const usage = normalizeGeminiQuota(
      {
        quotas: [{ modelId: "gemini-2.5-flash", remaining_fraction: 0.5 }],
      },
      options,
    );

    expect(usage.windows[0]).toMatchObject({
      id: "gemini-2.5-flash",
      usedPercent: 50,
    });
  });

  it("skips an entry with no fraction or no model", () => {
    const usage = normalizeGeminiQuota(
      {
        userQuotas: [
          { model: "gemini-2.5-pro" },
          { remainingFraction: 0.5 },
          { model: "gemini-2.5-flash", remainingFraction: 1 },
        ],
      },
      options,
    );

    expect(usage.windows.map((window) => window.id)).toEqual([
      "gemini-2.5-flash",
    ]);
    expect(usage.windows[0].usedPercent).toBe(0);
  });

  it("drops an unparseable reset time rather than the window", () => {
    const usage = normalizeGeminiQuota(
      {
        userQuotas: [
          {
            model: "gemini-2.5-pro",
            remainingFraction: 0.5,
            resetTime: "soon",
          },
        ],
      },
      options,
    );

    expect(usage.windows[0].resetsAt).toBeNull();
  });

  it("reports no windows for an account with nothing metered", () => {
    const usage = normalizeGeminiQuota({ userQuotas: [] }, options);

    expect(usage.windows).toEqual([]);
    expect(usage.accountLabel).toBe("ada@example.com");
  });

  it("raises a schema error when the quota list is missing", () => {
    expect(() => normalizeGeminiQuota({ tier: "free" }, options)).toThrow(
      ProviderError,
    );
    expect(() => normalizeGeminiQuota("nope", options)).toThrow(ProviderError);
  });
});
