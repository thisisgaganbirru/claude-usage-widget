import { describe, expect, it } from "vitest";
import { ProviderError } from "../../types";
import {
  labelForMinutes,
  normalizeCodexSnapshot,
  readRateLimitWindow,
} from "../normalize";

const FETCHED_AT = "2026-03-10T00:00:00.000Z";
const options = { accountLabel: "ada@example.com", fetchedAt: FETCHED_AT };

/** 2026-03-10T05:00:00Z as Unix seconds, the way a rollout file states it. */
const RESET_SECONDS = 1773111600;
const RESET_ISO = new Date(RESET_SECONDS * 1000).toISOString();

describe("readRateLimitWindow", () => {
  it("reads the snake_case casing the rollout files use", () => {
    const window = readRateLimitWindow(
      {
        primary: {
          used_percent: 42.5,
          window_minutes: 300,
          resets_at: RESET_SECONDS,
        },
      },
      "primary",
      "primary",
    );

    expect(window).toEqual({
      usedPercent: 42.5,
      windowMinutes: 300,
      resetsAt: RESET_ISO,
    });
  });

  it("reads the camelCase casing the app-server protocol uses", () => {
    const window = readRateLimitWindow(
      {
        primary: {
          usedPercent: 42.5,
          windowDurationMins: 300,
          resetsAt: RESET_SECONDS,
        },
      },
      "primary",
      "primary",
    );

    expect(window).toEqual({
      usedPercent: 42.5,
      windowMinutes: 300,
      resetsAt: RESET_ISO,
    });
  });

  it("returns null for a window the snapshot does not carry", () => {
    expect(readRateLimitWindow({}, "secondary", "secondary")).toBeNull();
    expect(
      readRateLimitWindow({ secondary: null }, "secondary", "secondary"),
    ).toBeNull();
  });

  it("clamps a percentage outside the renderable range", () => {
    expect(
      readRateLimitWindow({ primary: { used_percent: 140 } }, "primary", "p")
        ?.usedPercent,
    ).toBe(100);
    expect(
      readRateLimitWindow({ primary: { used_percent: -3 } }, "primary", "p")
        ?.usedPercent,
    ).toBe(0);
  });

  it("tolerates a timestamp stated in milliseconds", () => {
    const window = readRateLimitWindow(
      { primary: { used_percent: 1, resets_at: RESET_SECONDS * 1000 } },
      "primary",
      "primary",
    );

    expect(window?.resetsAt).toBe(RESET_ISO);
  });

  it("treats a missing reset as no reset rather than the epoch", () => {
    const window = readRateLimitWindow(
      { primary: { used_percent: 1, resets_at: 0 } },
      "primary",
      "primary",
    );

    expect(window?.resetsAt).toBeNull();
  });

  it("throws a schema error for a percentage that is not a number", () => {
    expect(() =>
      readRateLimitWindow({ primary: { used_percent: "42" } }, "primary", "p"),
    ).toThrow(ProviderError);
  });

  it("throws a schema error for a non-positive window length", () => {
    expect(() =>
      readRateLimitWindow(
        { primary: { used_percent: 1, window_minutes: 0 } },
        "primary",
        "p",
      ),
    ).toThrow(/window_minutes/);
  });
});

describe("labelForMinutes", () => {
  it("names the window lengths the UI has phrasing for", () => {
    expect(labelForMinutes(300, "x")).toBe("5h limit");
    expect(labelForMinutes(10080, "x")).toBe("7d weekly");
    expect(labelForMinutes(43200, "x")).toBe("30d limit");
  });

  it("derives a label for a length nobody anticipated", () => {
    expect(labelForMinutes(60, "x")).toBe("1h limit");
    expect(labelForMinutes(2880, "x")).toBe("2d limit");
    expect(labelForMinutes(45, "x")).toBe("45m limit");
  });

  it("falls back when the vendor reports no length", () => {
    expect(labelForMinutes(null, "Primary limit")).toBe("Primary limit");
  });
});

describe("normalizeCodexSnapshot", () => {
  it("emits both windows in slot order", () => {
    const usage = normalizeCodexSnapshot(
      {
        primary: {
          used_percent: 12,
          window_minutes: 300,
          resets_at: RESET_SECONDS,
        },
        secondary: { used_percent: 60, window_minutes: 10080 },
      },
      options,
    );

    expect(usage.providerId).toBe("codex");
    expect(usage.accountLabel).toBe("ada@example.com");
    expect(usage.fetchedAt).toBe(FETCHED_AT);
    expect(usage.windows.map((window) => window.id)).toEqual([
      "primary",
      "secondary",
    ]);
    expect(usage.windows[0].label).toBe("5h limit");
    expect(usage.windows[1].label).toBe("7d weekly");
    expect(usage.windows[1].resetsAt).toBeNull();
  });

  it("keeps a snapshot that reports only one window", () => {
    const usage = normalizeCodexSnapshot(
      { primary: { used_percent: 12 } },
      options,
    );

    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0].label).toBe("Primary limit");
    expect(usage.windows[0].windowMinutes).toBeUndefined();
  });

  it("prefers the plan the snapshot carries over the one passed in", () => {
    const usage = normalizeCodexSnapshot(
      { primary: { used_percent: 1 }, plan_type: "pro" },
      { ...options, plan: "Plus" },
    );

    expect(usage.plan).toBe("Pro");
  });

  it("falls back to the plan from auth.json", () => {
    const usage = normalizeCodexSnapshot(
      { primary: { used_percent: 1 } },
      {
        ...options,
        plan: "Plus",
      },
    );

    expect(usage.plan).toBe("Plus");
  });

  it("refuses a snapshot with neither window rather than reporting zero", () => {
    expect(() => normalizeCodexSnapshot({}, options)).toThrow(ProviderError);
    expect(() => normalizeCodexSnapshot({}, options)).toThrow(/rate_limits/);
  });

  it("refuses anything that is not an object", () => {
    expect(() => normalizeCodexSnapshot(null, options)).toThrow(ProviderError);
  });
});
