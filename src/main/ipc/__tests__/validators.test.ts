import { describe, expect, it } from "vitest";

import {
  MAX_ACCOUNT_ID_LENGTH,
  MAX_SHORTCUT_LENGTH,
  MAX_URL_LENGTH,
  isAccountId,
  isExternalUrlCandidate,
  isFiniteNumber,
  isNonEmptyString,
  isProvider,
  isWindowDimension,
  pickSettingsPatch,
  toOptionalProvider,
  toProvider,
} from "../validators";

describe("isProvider", () => {
  it("accepts the known providers", () => {
    expect(isProvider("claude")).toBe(true);
    expect(isProvider("chatgpt")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of [
      "CLAUDE",
      "gemini",
      "",
      null,
      undefined,
      42,
      ["claude"],
      { provider: "claude" },
    ]) {
      expect(isProvider(value)).toBe(false);
    }
  });

  it("does not treat inherited properties as providers", () => {
    expect(isProvider("toString")).toBe(false);
    expect(isProvider("constructor")).toBe(false);
  });
});

describe("toProvider", () => {
  it("passes a valid provider through", () => {
    expect(toProvider("chatgpt")).toBe("chatgpt");
  });

  it("falls back for junk", () => {
    expect(toProvider(undefined)).toBe("claude");
    expect(toProvider({ evil: true })).toBe("claude");
    expect(toProvider("gemini", "chatgpt")).toBe("chatgpt");
  });
});

describe("toOptionalProvider", () => {
  it("returns undefined rather than a default", () => {
    expect(toOptionalProvider(undefined)).toBeUndefined();
    expect(toOptionalProvider("nope")).toBeUndefined();
    expect(toOptionalProvider("claude")).toBe("claude");
  });
});

describe("number and string guards", () => {
  it("rejects non-finite numbers", () => {
    expect(isFiniteNumber(1)).toBe(true);
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteNumber("30")).toBe(false);
  });

  it("treats whitespace as empty", () => {
    expect(isNonEmptyString("  ")).toBe(false);
    expect(isNonEmptyString("x")).toBe(true);
    expect(isNonEmptyString(null)).toBe(false);
  });

  it("bounds account ids", () => {
    expect(isAccountId("abc")).toBe(true);
    expect(isAccountId("a".repeat(MAX_ACCOUNT_ID_LENGTH))).toBe(true);
    expect(isAccountId("a".repeat(MAX_ACCOUNT_ID_LENGTH + 1))).toBe(false);
    expect(isAccountId("")).toBe(false);
  });

  it("bounds external url candidates", () => {
    expect(isExternalUrlCandidate("https://claude.ai/")).toBe(true);
    expect(
      isExternalUrlCandidate(`https://claude.ai/${"a".repeat(MAX_URL_LENGTH)}`),
    ).toBe(false);
    expect(isExternalUrlCandidate(12)).toBe(false);
  });

  it("bounds window dimensions", () => {
    expect(isWindowDimension(350)).toBe(true);
    expect(isWindowDimension(0)).toBe(false);
    expect(isWindowDimension(-100)).toBe(false);
    expect(isWindowDimension(10001)).toBe(false);
    expect(isWindowDimension(Number.NaN)).toBe(false);
  });
});

describe("pickSettingsPatch", () => {
  it("returns an empty patch for non-objects", () => {
    expect(pickSettingsPatch(null)).toEqual({});
    expect(pickSettingsPatch(undefined)).toEqual({});
    expect(pickSettingsPatch("theme=dark")).toEqual({});
    expect(pickSettingsPatch([1, 2, 3])).toEqual({});
  });

  it("keeps only the recognised keys", () => {
    const patch = pickSettingsPatch({
      pollingInterval: 45,
      theme: "dark",
      __proto__: { polluted: true },
      apiKey: "sk-ant-secret",
      nested: { deep: true },
    });

    expect(patch).toEqual({ pollingInterval: 45, theme: "dark" });
    expect("apiKey" in patch).toBe(false);
    expect("nested" in patch).toBe(false);
  });

  it("drops keys whose type is wrong", () => {
    const patch = pickSettingsPatch({
      pollingInterval: "60",
      startOnBoot: "yes",
      keepInTray: 1,
      theme: "neon",
      quickEntryShortcut: 42,
    });

    expect(patch).toEqual({});
  });

  it("copies threshold arrays instead of aliasing them", () => {
    const thresholds = [10, 20];
    const patch = pickSettingsPatch({ notificationThresholds: thresholds });

    expect(patch.notificationThresholds).toEqual([10, 20]);
    expect(patch.notificationThresholds).not.toBe(thresholds);
  });

  it("rejects threshold lists with bad members or absurd length", () => {
    expect(pickSettingsPatch({ notificationThresholds: [10, "20"] })).toEqual(
      {},
    );
    expect(pickSettingsPatch({ notificationThresholds: [0] })).toEqual({});
    expect(pickSettingsPatch({ notificationThresholds: [101] })).toEqual({});
    expect(
      pickSettingsPatch({
        weeklyNotificationThresholds: Array.from({ length: 17 }, () => 50),
      }),
    ).toEqual({});
  });

  it("bounds the shortcut length", () => {
    expect(
      pickSettingsPatch({ quickEntryShortcut: "a".repeat(MAX_SHORTCUT_LENGTH) })
        .quickEntryShortcut,
    ).toHaveLength(MAX_SHORTCUT_LENGTH);
    expect(
      pickSettingsPatch({
        quickEntryShortcut: "a".repeat(MAX_SHORTCUT_LENGTH + 1),
      }),
    ).toEqual({});
  });

  it("accepts a full, valid settings object", () => {
    const full = {
      pollingInterval: 90,
      notificationThresholds: [50, 90],
      weeklyNotificationThresholds: [75],
      enableDesktopNotifications: false,
      enableBannerNotifications: true,
      startOnBoot: true,
      keepInTray: false,
      quickEntryShortcut: "Control+Alt+Space",
      theme: "light" as const,
    };

    expect(pickSettingsPatch(full)).toEqual(full);
  });
});
