import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  normalizeThresholds,
} from "../normalize";

describe("normalizeThresholds", () => {
  it("drops non-numbers, non-finite values, and values outside (0, 100]", () => {
    expect(
      normalizeThresholds([50, "75", NaN, Infinity, 0, -5, 100, 101, null]),
    ).toEqual([50, 100]);
  });

  it("dedupes and sorts ascending", () => {
    expect(normalizeThresholds([95, 50, 95, 75])).toEqual([50, 75, 95]);
  });

  it("returns an empty list for a non-array", () => {
    expect(normalizeThresholds(undefined)).toEqual([]);
    expect(normalizeThresholds("50,75")).toEqual([]);
  });
});

describe("normalizeSettings", () => {
  it("returns the defaults for empty input", () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps the polling interval into 30..300 seconds", () => {
    expect(normalizeSettings({ pollingInterval: 5 }).pollingInterval).toBe(30);
    expect(normalizeSettings({ pollingInterval: 900 }).pollingInterval).toBe(
      300,
    );
    expect(normalizeSettings({ pollingInterval: 120 }).pollingInterval).toBe(
      120,
    );
  });

  it("falls back to the default interval when the value is not a finite number", () => {
    expect(normalizeSettings({ pollingInterval: NaN }).pollingInterval).toBe(
      DEFAULT_SETTINGS.pollingInterval,
    );
    expect(
      normalizeSettings({ pollingInterval: "60" as unknown as number })
        .pollingInterval,
    ).toBe(DEFAULT_SETTINGS.pollingInterval);
  });

  it("keeps valid custom thresholds and restores defaults when none survive", () => {
    expect(
      normalizeSettings({ notificationThresholds: [90, 60] })
        .notificationThresholds,
    ).toEqual([60, 90]);
    expect(
      normalizeSettings({ notificationThresholds: [0, 150] })
        .notificationThresholds,
    ).toEqual(DEFAULT_SETTINGS.notificationThresholds);
    expect(
      normalizeSettings({ weeklyNotificationThresholds: [] })
        .weeklyNotificationThresholds,
    ).toEqual(DEFAULT_SETTINGS.weeklyNotificationThresholds);
  });

  it("coerces boolean fields", () => {
    const result = normalizeSettings({
      startOnBoot: 1 as unknown as boolean,
      keepInTray: 0 as unknown as boolean,
      enableDesktopNotifications: "" as unknown as boolean,
      enableBannerNotifications: "yes" as unknown as boolean,
    });
    expect(result.startOnBoot).toBe(true);
    expect(result.keepInTray).toBe(false);
    expect(result.enableDesktopNotifications).toBe(false);
    expect(result.enableBannerNotifications).toBe(true);
  });

  it("trims the shortcut and restores the default when it is blank", () => {
    expect(
      normalizeSettings({ quickEntryShortcut: "  Control+Shift+U " })
        .quickEntryShortcut,
    ).toBe("Control+Shift+U");
    expect(
      normalizeSettings({ quickEntryShortcut: "   " }).quickEntryShortcut,
    ).toBe(DEFAULT_SETTINGS.quickEntryShortcut);
  });

  it("rejects unknown theme values", () => {
    expect(
      normalizeSettings({ theme: "sepia" as unknown as WidgetTheme }).theme,
    ).toBe("auto");
    expect(normalizeSettings({ theme: "dark" }).theme).toBe("dark");
  });
});

type WidgetTheme = "light" | "dark" | "auto";
