import { describe, expect, it } from "vitest";
import { isLegacySettings, migrateSettings, migrateV1ToV2 } from "../migrate";
import { createDefaultSettings } from "../normalize";

function v1Settings(overrides: Record<string, unknown> = {}) {
  return {
    pollingInterval: 120,
    notificationThresholds: [50, 75, 90, 95],
    weeklyNotificationThresholds: [50, 75, 90, 100],
    enableDesktopNotifications: true,
    enableBannerNotifications: false,
    startOnBoot: true,
    keepInTray: false,
    quickEntryShortcut: "Control+Shift+U",
    theme: "dark",
    ...overrides,
  };
}

describe("isLegacySettings", () => {
  it("recognizes a v1 file by its missing version and its interval field", () => {
    expect(isLegacySettings(v1Settings())).toBe(true);
  });

  it("does not treat a v2 file as legacy", () => {
    expect(isLegacySettings(createDefaultSettings())).toBe(false);
  });

  it("does not treat junk as legacy", () => {
    expect(isLegacySettings(null)).toBe(false);
    expect(isLegacySettings("settings")).toBe(false);
    expect(isLegacySettings({})).toBe(false);
  });
});

describe("migrateV1ToV2", () => {
  it("carries the single interval onto every provider", () => {
    const migrated = migrateV1ToV2(v1Settings());

    for (const provider of Object.values(migrated.providers)) {
      expect(provider.intervalSec).toBe(120);
    }
  });

  it("unions the two threshold lists so no configured value is lost", () => {
    const migrated = migrateV1ToV2(
      v1Settings({
        notificationThresholds: [50, 95],
        weeklyNotificationThresholds: [75, 100],
      }),
    );

    expect(migrated.providers.claude.thresholds).toEqual([50, 75, 95, 100]);
  });

  it("clamps an out-of-range v1 interval rather than carrying it forward", () => {
    const migrated = migrateV1ToV2(v1Settings({ pollingInterval: 5 }));

    expect(migrated.providers.claude.intervalSec).toBe(30);
  });

  it("preserves the non-provider preferences", () => {
    const migrated = migrateV1ToV2(v1Settings());

    expect(migrated.enableDesktopNotifications).toBe(true);
    expect(migrated.enableBannerNotifications).toBe(false);
    expect(migrated.startOnBoot).toBe(true);
    expect(migrated.keepInTray).toBe(false);
    expect(migrated.quickEntryShortcut).toBe("Control+Shift+U");
    expect(migrated.theme).toBe("dark");
  });

  it("stamps the new version", () => {
    expect(migrateV1ToV2(v1Settings()).version).toBe(2);
  });

  it("keeps the default thresholds when v1 had none left after cleaning", () => {
    const migrated = migrateV1ToV2(
      v1Settings({
        notificationThresholds: [0, 900],
        weeklyNotificationThresholds: [],
      }),
    );

    expect(migrated.providers.claude.thresholds).toEqual([50, 75, 90, 95]);
  });

  it("returns defaults for something that is not a settings object", () => {
    expect(migrateV1ToV2(null)).toEqual(createDefaultSettings());
  });
});

describe("migrateSettings", () => {
  it("upgrades a v1 file", () => {
    expect(migrateSettings(v1Settings()).version).toBe(2);
  });

  it("passes a v2 file through the normalizer unchanged", () => {
    const current = createDefaultSettings();

    expect(migrateSettings(current)).toEqual(current);
  });

  it("produces usable settings from a corrupt store", () => {
    expect(migrateSettings("nonsense")).toEqual(createDefaultSettings());
  });
});
