import { describe, expect, it } from "vitest";
import { ProviderError } from "../../types";
import { addOneMonth, normalizeCursorUsage, readNumber } from "../normalize";

const FETCHED_AT = "2026-09-17T00:00:00.000Z";
const options = {
  accountLabel: "ada@example.com",
  membership: null,
  fetchedAt: FETCHED_AT,
};

describe("readNumber", () => {
  it("reads a number stated either way", () => {
    expect(readNumber(400)).toBe(400);
    expect(readNumber("400")).toBe(400);
  });

  it("returns null for anything that is not one", () => {
    expect(readNumber(null)).toBeNull();
    expect(readNumber("")).toBeNull();
    expect(readNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("addOneMonth", () => {
  it("moves the period start on by a month", () => {
    expect(addOneMonth("2026-09-01T00:00:00.000Z")).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("clamps a day the next month does not have", () => {
    expect(addOneMonth("2026-01-31T00:00:00.000Z")).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("rolls over the year", () => {
    expect(addOneMonth("2026-12-05T10:00:00.000Z")).toBe(
      "2027-01-05T10:00:00.000Z",
    );
  });

  it("returns null for an unparseable date", () => {
    expect(addOneMonth("soon")).toBeNull();
  });
});

describe("normalizeCursorUsage", () => {
  it("reads spend against the limit and dates the reset a month on", () => {
    const usage = normalizeCursorUsage(
      {
        membershipType: "pro",
        startOfMonth: "2026-09-01T00:00:00.000Z",
        usedCents: 500,
        limitCents: 2000,
      },
      options,
    );

    expect(usage.providerId).toBe("cursor");
    expect(usage.plan).toBe("Pro");
    expect(usage.accountLabel).toBe("ada@example.com");
    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0]).toMatchObject({
      id: "individual",
      label: "Monthly spend",
      usedPercent: 25,
      resetsAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("reads the nested individual and team scopes", () => {
    const usage = normalizeCursorUsage(
      {
        startOfMonth: "2026-09-01T00:00:00.000Z",
        individualUsage: { totalCents: 750, hardLimitCents: 1500 },
        teamUsage: { usedCents: 100, limitCents: 1000 },
      },
      options,
    );

    expect(usage.windows.map((window) => window.id)).toEqual([
      "individual",
      "team",
    ]);
    expect(usage.windows[0].usedPercent).toBe(50);
    expect(usage.windows[1].usedPercent).toBe(10);
  });

  it("reads the older per-model request counts", () => {
    const usage = normalizeCursorUsage(
      {
        startOfMonth: "2026-09-01T00:00:00.000Z",
        "gpt-4": { numRequests: 250, maxRequestUsage: 500 },
        "gpt-3.5-turbo": { numRequests: 10, maxRequestUsage: null },
      },
      options,
    );

    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0]).toMatchObject({
      id: "gpt-4",
      usedPercent: 50,
      model: "gpt-4",
    });
  });

  it("clamps an overage past the limit to 100", () => {
    const usage = normalizeCursorUsage(
      {
        startOfMonth: "2026-09-01T00:00:00.000Z",
        usedCents: 3000,
        limitCents: 2000,
      },
      options,
    );

    expect(usage.windows[0].usedPercent).toBe(100);
  });

  it("falls back to the membership Cursor cached locally", () => {
    const usage = normalizeCursorUsage(
      { startOfMonth: "2026-09-01T00:00:00.000Z" },
      { ...options, membership: "free_trial" },
    );

    expect(usage.plan).toBe("Free trial");
  });

  it("reports no windows for an account with nothing metered", () => {
    const usage = normalizeCursorUsage(
      { membershipType: "business", activeSubscription: {} },
      options,
    );

    expect(usage.windows).toEqual([]);
    expect(usage.plan).toBe("Business");
  });

  it("raises a schema error when the response carries no Cursor marker", () => {
    expect(() => normalizeCursorUsage({ error: "nope" }, options)).toThrow(
      ProviderError,
    );
    expect(() => normalizeCursorUsage("nope", options)).toThrow(ProviderError);
  });
});
