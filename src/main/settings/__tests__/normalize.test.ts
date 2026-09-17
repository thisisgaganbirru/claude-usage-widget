import { describe, expect, it } from "vitest";
import {
  createDefaultSettings,
  DEFAULT_SETTINGS,
  normalizeSettings,
  normalizeThresholds,
} from "../normalize";

type WidgetTheme = "light" | "dark" | "auto";

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

  it("gives every known provider a block", () => {
    const settings = normalizeSettings({});

    expect(Object.keys(settings.providers).sort()).toEqual([
      "chatgpt",
      "claude",
      "codex",
      "copilot",
      "cursor",
      "gemini",
    ]);
  });

  it("enables only the providers that can read something today", () => {
    const settings = normalizeSettings({});

    expect(settings.providers.claude.enabled).toBe(true);
    expect(settings.providers.chatgpt.enabled).toBe(true);
    expect(settings.providers.codex.enabled).toBe(true);
    expect(settings.providers.cursor.enabled).toBe(false);
  });

  it("clamps each provider interval into 30..300 seconds", () => {
    const settings = normalizeSettings({
      providers: {
        ...createDefaultSettings().providers,
        claude: { enabled: true, intervalSec: 5, thresholds: [50] },
        chatgpt: { enabled: true, intervalSec: 900, thresholds: [50] },
      },
    });

    expect(settings.providers.claude.intervalSec).toBe(30);
    expect(settings.providers.chatgpt.intervalSec).toBe(300);
  });

  it("falls back to the default interval when the value is not a finite number", () => {
    const settings = normalizeSettings({
      providers: {
        ...createDefaultSettings().providers,
        claude: {
          enabled: true,
          intervalSec: NaN,
          thresholds: [50],
        },
      },
    });

    expect(settings.providers.claude.intervalSec).toBe(60);
  });

  it("keeps valid thresholds and restores defaults when none survive", () => {
    const withCustom = normalizeSettings({
      providers: {
        ...createDefaultSettings().providers,
        claude: { enabled: true, intervalSec: 60, thresholds: [90, 60] },
        chatgpt: { enabled: true, intervalSec: 60, thresholds: [0, 150] },
      },
    });

    expect(withCustom.providers.claude.thresholds).toEqual([60, 90]);
    expect(withCustom.providers.chatgpt.thresholds).toEqual([50, 75, 90, 95]);
  });

  it("replaces a provider block that is not an object with the default", () => {
    const settings = normalizeSettings({
      providers: {
        claude: "nonsense",
      } as never,
    });

    expect(settings.providers.claude).toEqual({
      enabled: true,
      intervalSec: 60,
      thresholds: [50, 75, 90, 95],
    });
  });

  it("falls back to defaults for boolean fields that are not booleans", () => {
    const result = normalizeSettings({
      startOnBoot: 1 as unknown as boolean,
      keepInTray: 0 as unknown as boolean,
      enableDesktopNotifications: "" as unknown as boolean,
    });

    expect(result.startOnBoot).toBe(false);
    expect(result.keepInTray).toBe(true);
    expect(result.enableDesktopNotifications).toBe(true);
  });

  it("keeps boolean fields that really are booleans", () => {
    const result = normalizeSettings({
      startOnBoot: true,
      keepInTray: false,
      enableBannerNotifications: false,
    });

    expect(result.startOnBoot).toBe(true);
    expect(result.keepInTray).toBe(false);
    expect(result.enableBannerNotifications).toBe(false);
  });

  it("trims the shortcut and restores the default when it is blank", () => {
    expect(
      normalizeSettings({ quickEntryShortcut: "  Control+Shift+U " })
        .quickEntryShortcut,
    ).toBe("Control+Shift+U");
    expect(
      normalizeSettings({ quickEntryShortcut: "   " }).quickEntryShortcut,
    ).toBe("Control+Alt+Space");
  });

  it("rejects unknown theme values", () => {
    expect(
      normalizeSettings({ theme: "sepia" as unknown as WidgetTheme }).theme,
    ).toBe("auto");
    expect(normalizeSettings({ theme: "dark" }).theme).toBe("dark");
  });

  it("always stamps the current schema version", () => {
    expect(normalizeSettings({ version: 1 as never }).version).toBe(2);
  });
});
