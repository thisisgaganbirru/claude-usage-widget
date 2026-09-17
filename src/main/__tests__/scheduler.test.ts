import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureLogging, resetLogging } from "@main/logging/logger";
import {
  applyJitter,
  backoffDelayMs,
  Scheduler,
  type SchedulerHost,
  type SchedulerHostHandlers,
  type ThresholdRecord,
  type ThresholdStore,
} from "@main/scheduler";
import {
  ProviderError,
  type Credential,
  type UsageProvider,
} from "@main/providers/types";
import type { ThresholdCrossedEvent, WidgetSettings } from "@shared/types";
import { createDefaultSettings } from "@main/settings/normalize";
import type { ProviderState, ProviderUsage, UsageWindow } from "@shared/usage";

const CREDENTIAL: Credential = {
  providerId: "claude",
  kind: "cookie",
  secret: "sk-not-a-real-secret",
  expiresAt: null,
};

function usage(
  windows: UsageWindow[],
  fetchedAt = "2026-01-01T00:00:00.000Z",
): ProviderUsage {
  return {
    providerId: "claude",
    accountLabel: "Test Org",
    plan: "Pro",
    windows,
    fetchedAt,
  };
}

function sessionWindow(
  usedPercent: number,
  resetsAt: string | null = "2026-01-01T05:00:00.000Z",
): UsageWindow {
  return { id: "session", label: "5h session", usedPercent, resetsAt };
}

/** A host with hand-driven power and network events. */
function createHost(): SchedulerHost & {
  handlers: SchedulerHostHandlers | null;
  online: boolean;
} {
  const host = {
    handlers: null as SchedulerHostHandlers | null,
    online: true,
    now: () => Date.now(),
    isOnline: () => host.online,
    subscribe(handlers: SchedulerHostHandlers): () => void {
      host.handlers = handlers;
      return () => {
        host.handlers = null;
      };
    },
  };
  return host;
}

function createThresholdStore(): ThresholdStore & {
  state: Record<string, ThresholdRecord>;
} {
  const store = {
    state: {} as Record<string, ThresholdRecord>,
    read: () => store.state,
    write: (next: Record<string, ThresholdRecord>) => {
      store.state = next;
    },
  };
  return store;
}

interface Harness {
  scheduler: Scheduler;
  host: ReturnType<typeof createHost>;
  store: ReturnType<typeof createThresholdStore>;
  provider: UsageProvider;
  fetchUsage: ReturnType<typeof vi.fn>;
  discoverCredentials: ReturnType<typeof vi.fn>;
  settings: WidgetSettings;
  states: Array<{ providerId: string; state: ProviderState }>;
  thresholdEvents: ThresholdCrossedEvent[];
}

/** One enabled provider ("claude"); everything else is unregistered. */
function setup(overrides: Partial<WidgetSettings> = {}): Harness {
  const settings: WidgetSettings = { ...createDefaultSettings(), ...overrides };
  const host = createHost();
  const store = createThresholdStore();

  const discoverCredentials = vi.fn(
    async () => CREDENTIAL as Credential | null,
  );
  const fetchUsage = vi.fn(async () => usage([sessionWindow(10)]));

  const provider: UsageProvider = {
    id: "claude",
    displayName: "Claude",
    defaultIntervalSec: 60,
    discoverCredentials,
    fetchUsage,
    login: async () => null,
  };

  const scheduler = new Scheduler({
    host,
    getSettings: () => settings,
    getProvider: (id) => (id === "claude" ? provider : null),
    thresholds: store,
  });

  const states: Array<{ providerId: string; state: ProviderState }> = [];
  const thresholdEvents: ThresholdCrossedEvent[] = [];
  scheduler.on("state", (event) => states.push(event));
  scheduler.on("threshold", (event) => thresholdEvents.push(event));

  return {
    scheduler,
    host,
    store,
    provider,
    fetchUsage,
    discoverCredentials,
    settings,
    states,
    thresholdEvents,
  };
}

/** Run everything due at or before `ms` from now, flushing promises as it goes. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("applyJitter", () => {
  it("returns the delay untouched at the midpoint", () => {
    expect(applyJitter(60_000, 0.5)).toBe(60_000);
  });

  it("spreads recurring timers by ten percent either way", () => {
    expect(applyJitter(60_000, 0)).toBe(54_000);
    expect(applyJitter(60_000, 1)).toBe(66_000);
  });

  it("never returns a negative delay", () => {
    expect(applyJitter(0, 0)).toBe(0);
  });
});

describe("backoffDelayMs", () => {
  it("starts at five seconds and doubles", () => {
    expect(backoffDelayMs(1)).toBe(5_000);
    expect(backoffDelayMs(2)).toBe(10_000);
    expect(backoffDelayMs(3)).toBe(20_000);
    expect(backoffDelayMs(4)).toBe(40_000);
  });

  it("caps at five minutes however long the outage lasts", () => {
    expect(backoffDelayMs(20)).toBe(300_000);
    expect(backoffDelayMs(200)).toBe(300_000);
  });

  it("treats a zero count as the first failure", () => {
    expect(backoffDelayMs(0)).toBe(5_000);
  });
});

describe("Scheduler", () => {
  beforeEach(() => {
    configureLogging({ sinks: [] });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    // Jitter is exercised directly above; pin it here so delays are exact.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetLogging();
  });

  it("polls immediately on start and then on the configured interval", async () => {
    const harness = setup();
    harness.scheduler.start();

    await advance(0);
    expect(harness.fetchUsage).toHaveBeenCalledTimes(1);

    await advance(59_999);
    expect(harness.fetchUsage).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(harness.fetchUsage).toHaveBeenCalledTimes(2);

    harness.scheduler.stop();
  });

  it("stops polling once stopped", async () => {
    const harness = setup();
    harness.scheduler.start();
    await advance(0);
    harness.scheduler.stop();

    await advance(600_000);
    expect(harness.fetchUsage).toHaveBeenCalledTimes(1);
  });

  it("skips a provider that has no registered adapter", async () => {
    const harness = setup();
    harness.settings.providers.chatgpt.enabled = true;
    harness.scheduler.start();

    await advance(0);
    expect(
      harness.scheduler.snapshot().map((entry) => entry.providerId),
    ).toEqual(["claude"]);

    harness.scheduler.stop();
  });

  it("reports needs-auth without a timer when no credential is found", async () => {
    const harness = setup();
    harness.discoverCredentials.mockResolvedValue(null);
    harness.scheduler.start();

    await advance(0);
    expect(harness.states.at(-1)?.state.kind).toBe("needs-auth");

    await advance(600_000);
    expect(harness.discoverCredentials).toHaveBeenCalledTimes(1);

    harness.scheduler.stop();
  });

  describe("failure policy", () => {
    it("backs off exponentially on a network error", async () => {
      const harness = setup();
      harness.fetchUsage.mockRejectedValue(
        new ProviderError("network", "connect ECONNREFUSED"),
      );
      harness.scheduler.start();

      await advance(0);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(1);

      await advance(5_000);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(2);

      await advance(9_999);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(2);

      await advance(1);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(3);

      harness.scheduler.stop();
    });

    it("resets the backoff after a success", async () => {
      const harness = setup();
      harness.fetchUsage
        .mockRejectedValueOnce(new ProviderError("network", "down"))
        .mockRejectedValueOnce(new ProviderError("network", "down"))
        .mockResolvedValueOnce(usage([sessionWindow(10)]))
        .mockRejectedValue(new ProviderError("network", "down"));
      harness.scheduler.start();

      await advance(0);
      await advance(5_000); // second failure
      await advance(10_000); // success, back to the normal interval
      expect(harness.fetchUsage).toHaveBeenCalledTimes(3);

      await advance(60_000); // fourth call fails as the first failure again
      expect(harness.fetchUsage).toHaveBeenCalledTimes(4);

      await advance(5_000);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(5);

      harness.scheduler.stop();
    });

    it("honours Retry-After on a 429", async () => {
      const harness = setup();
      harness.fetchUsage.mockRejectedValue(
        new ProviderError("rate-limited", "slow down", { retryAfterSec: 30 }),
      );
      harness.scheduler.start();

      await advance(0);
      await advance(29_999);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(1);

      await advance(1);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(2);

      harness.scheduler.stop();
    });

    it("waits fifteen minutes on a 429 with no Retry-After", async () => {
      const harness = setup();
      harness.fetchUsage.mockRejectedValue(
        new ProviderError("rate-limited", "slow down"),
      );
      harness.scheduler.start();

      await advance(0);
      await advance(899_999);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(1);

      await advance(1);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(2);

      harness.scheduler.stop();
    });

    it("keeps the normal cadence on a schema error so a fix is noticed", async () => {
      const harness = setup();
      harness.fetchUsage.mockRejectedValue(
        new ProviderError(
          "schema",
          "usage.five_hour.utilization is not a number",
        ),
      );
      harness.scheduler.start();

      await advance(0);
      await advance(60_000);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(2);

      await advance(60_000);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(3);

      harness.scheduler.stop();
    });

    it("stops polling on an auth error instead of burning requests", async () => {
      const harness = setup();
      harness.fetchUsage.mockRejectedValue(
        new ProviderError("auth", "session expired", { statusCode: 401 }),
      );
      harness.scheduler.start();

      await advance(0);
      expect(harness.states.at(-1)?.state.kind).toBe("needs-auth");

      await advance(600_000);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(1);

      harness.scheduler.stop();
    });

    it("treats an untyped throw as unknown and backs off", async () => {
      const harness = setup();
      harness.fetchUsage.mockRejectedValue(new Error("boom"));
      harness.scheduler.start();

      await advance(0);
      const state = harness.states.at(-1)?.state;
      expect(state?.kind).toBe("error");
      expect(state).toMatchObject({ code: "unknown" });

      await advance(5_000);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(2);

      harness.scheduler.stop();
    });

    it("puts the next attempt time on the error state", async () => {
      const harness = setup();
      harness.fetchUsage.mockRejectedValue(
        new ProviderError("network", "down"),
      );
      harness.scheduler.start();

      await advance(0);
      const state = harness.states.at(-1)?.state;
      expect(state).toMatchObject({
        kind: "error",
        retryAt: "2026-01-01T00:00:05.000Z",
      });

      harness.scheduler.stop();
    });
  });

  describe("suspend and resume", () => {
    it("does not poll while suspended and polls again just after resume", async () => {
      const harness = setup();
      harness.scheduler.start();
      await advance(0);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(1);

      harness.host.handlers?.onSuspend();
      await advance(600_000);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(1);

      harness.host.handlers?.onResume();
      await advance(250);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(2);

      harness.scheduler.stop();
    });

    it("pauses when the network drops and resumes when it returns", async () => {
      const harness = setup();
      harness.scheduler.start();
      await advance(0);

      harness.host.handlers?.onOffline();
      await advance(600_000);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(1);

      harness.host.handlers?.onOnline();
      await advance(250);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(2);

      harness.scheduler.stop();
    });

    it("starts paused when the machine is already offline", async () => {
      const harness = setup();
      harness.host.online = false;
      harness.scheduler.start();

      await advance(600_000);
      expect(harness.fetchUsage).not.toHaveBeenCalled();

      harness.host.handlers?.onOnline();
      await advance(250);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(1);

      harness.scheduler.stop();
    });
  });

  describe("refresh", () => {
    it("coalesces concurrent refreshes into one request", async () => {
      const harness = setup();
      harness.scheduler.start();
      await advance(0);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(1);

      // Hold the second fetch open so both refreshes overlap it.
      let release = (): void => {};
      harness.fetchUsage.mockImplementation(
        () =>
          new Promise<ProviderUsage>((resolve) => {
            release = () => resolve(usage([sessionWindow(10)]));
          }),
      );

      const first = harness.scheduler.refresh("claude");
      const second = harness.scheduler.refresh("claude");
      await advance(0);
      release();
      await Promise.all([first, second]);

      expect(harness.fetchUsage).toHaveBeenCalledTimes(2);

      harness.scheduler.stop();
    });

    it("refreshes every enabled provider when given no id", async () => {
      const harness = setup();
      harness.scheduler.start();
      await advance(0);

      await harness.scheduler.refresh();
      expect(harness.fetchUsage).toHaveBeenCalledTimes(2);

      harness.scheduler.stop();
    });
  });

  describe("applySettings", () => {
    it("re-times an existing provider against the new interval", async () => {
      const harness = setup();
      harness.scheduler.start();
      await advance(0);

      harness.settings.providers.claude.intervalSec = 120;
      harness.scheduler.applySettings();

      await advance(119_999);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(1);

      await advance(1);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(2);

      harness.scheduler.stop();
    });

    it("drops a provider the user just disabled", async () => {
      const harness = setup();
      harness.scheduler.start();
      await advance(0);

      harness.settings.providers.claude.enabled = false;
      harness.scheduler.applySettings();

      await advance(600_000);
      expect(harness.fetchUsage).toHaveBeenCalledTimes(1);
      expect(harness.scheduler.snapshot()).toEqual([]);

      harness.scheduler.stop();
    });

    it("announces the drop so the tray stops counting it", async () => {
      // The reading is gone from the snapshot, but the tray holds its own copy.
      // Without this event it keeps colouring the icon by a provider the user
      // switched off.
      const harness = setup();
      const dropped: Array<{ providerId: string }> = [];
      harness.scheduler.on("dropped", (event) => dropped.push(event));
      harness.scheduler.start();
      await advance(0);

      harness.settings.providers.claude.enabled = false;
      harness.scheduler.applySettings();

      expect(dropped).toEqual([{ providerId: "claude" }]);

      harness.scheduler.stop();
    });
  });

  describe("thresholds", () => {
    it("fires once for every threshold the window has passed", async () => {
      const harness = setup();
      harness.fetchUsage.mockResolvedValue(usage([sessionWindow(80)]));
      harness.scheduler.start();
      await advance(0);

      expect(harness.thresholdEvents.map((event) => event.threshold)).toEqual([
        50, 75,
      ]);

      harness.scheduler.stop();
    });

    it("does not re-fire on the next poll of the same window", async () => {
      const harness = setup();
      harness.fetchUsage.mockResolvedValue(usage([sessionWindow(80)]));
      harness.scheduler.start();
      await advance(0);
      await advance(60_000);

      expect(harness.thresholdEvents).toHaveLength(2);

      harness.scheduler.stop();
    });

    it("does not re-fire when the polling interval changes", async () => {
      // The bug this scheduler exists to fix: the old poller kept the alerted
      // set beside the timer, so re-timing the loop replayed every alert.
      const harness = setup();
      harness.fetchUsage.mockResolvedValue(usage([sessionWindow(80)]));
      harness.scheduler.start();
      await advance(0);
      expect(harness.thresholdEvents).toHaveLength(2);

      harness.settings.providers.claude.intervalSec = 150;
      harness.scheduler.applySettings();
      await advance(150_000);

      expect(harness.fetchUsage).toHaveBeenCalledTimes(2);
      expect(harness.thresholdEvents).toHaveLength(2);

      harness.scheduler.stop();
    });

    it("survives a restart because the state lives in the store", async () => {
      const store = createThresholdStore();
      store.state = {
        "claude:session": {
          resetsAt: "2026-01-01T05:00:00.000Z",
          fired: [50, 75],
        },
      };

      const settings = createDefaultSettings();
      const fetchUsage = vi.fn(async () => usage([sessionWindow(80)]));
      const events: ThresholdCrossedEvent[] = [];
      const scheduler = new Scheduler({
        host: createHost(),
        getSettings: () => settings,
        getProvider: (id) =>
          id === "claude"
            ? {
                id: "claude",
                displayName: "Claude",
                defaultIntervalSec: 60,
                discoverCredentials: async () => CREDENTIAL,
                fetchUsage,
              }
            : null,
        thresholds: store,
      });
      scheduler.on("threshold", (event) => events.push(event));

      scheduler.start();
      await advance(0);

      expect(events).toHaveLength(0);
      scheduler.stop();
    });

    it("re-arms when the window rolls over to a new reset time", async () => {
      const harness = setup();
      harness.fetchUsage
        .mockResolvedValueOnce(
          usage([sessionWindow(80, "2026-01-01T05:00:00.000Z")]),
        )
        .mockResolvedValue(
          usage([sessionWindow(80, "2026-01-01T10:00:00.000Z")]),
        );
      harness.scheduler.start();
      await advance(0);
      expect(harness.thresholdEvents).toHaveLength(2);

      await advance(60_000);
      expect(harness.thresholdEvents).toHaveLength(4);

      harness.scheduler.stop();
    });

    it("re-arms when usage drops back below the lowest threshold", async () => {
      const harness = setup();
      harness.fetchUsage
        .mockResolvedValueOnce(usage([sessionWindow(80)]))
        .mockResolvedValueOnce(usage([sessionWindow(5)]))
        .mockResolvedValue(usage([sessionWindow(80)]));
      harness.scheduler.start();

      await advance(0);
      await advance(60_000);
      expect(harness.thresholdEvents).toHaveLength(2);

      await advance(60_000);
      expect(harness.thresholdEvents).toHaveLength(4);

      harness.scheduler.stop();
    });

    it("ignores per-model windows so one crossing is one notification", async () => {
      const harness = setup();
      harness.fetchUsage.mockResolvedValue(
        usage([
          sessionWindow(80),
          {
            id: "weekly-opus",
            label: "Opus weekly",
            usedPercent: 99,
            resetsAt: "2026-01-08T00:00:00.000Z",
            model: "opus",
          },
        ]),
      );
      harness.scheduler.start();
      await advance(0);

      expect(harness.thresholdEvents.map((event) => event.windowId)).toEqual([
        "session",
        "session",
      ]);

      harness.scheduler.stop();
    });

    it("records crossings but emits nothing when notifications are off", async () => {
      const harness = setup({
        enableDesktopNotifications: false,
        enableBannerNotifications: false,
      });
      harness.fetchUsage.mockResolvedValue(usage([sessionWindow(80)]));
      harness.scheduler.start();
      await advance(0);

      expect(harness.thresholdEvents).toHaveLength(0);
      // Kept, not cleared: re-enabling notifications must not replay alerts.
      expect(harness.store.state["claude:session"]).toEqual({
        resetsAt: "2026-01-01T05:00:00.000Z",
        fired: [50, 75],
      });

      harness.scheduler.stop();
    });

    it("stays quiet when the provider has no thresholds configured", async () => {
      const harness = setup();
      harness.settings.providers.claude.thresholds = [];
      harness.fetchUsage.mockResolvedValue(usage([sessionWindow(99)]));
      harness.scheduler.start();
      await advance(0);

      expect(harness.thresholdEvents).toHaveLength(0);

      harness.scheduler.stop();
    });

    it("carries the window label and percentage on the event", async () => {
      const harness = setup();
      harness.settings.providers.claude.thresholds = [75];
      harness.fetchUsage.mockResolvedValue(usage([sessionWindow(81.5)]));
      harness.scheduler.start();
      await advance(0);

      expect(harness.thresholdEvents[0]).toEqual({
        providerId: "claude",
        windowId: "session",
        windowLabel: "5h session",
        threshold: 75,
        usedPercent: 81.5,
      });

      harness.scheduler.stop();
    });
  });

  describe("staleness", () => {
    it("dims the last reading once a poll hangs past twice the interval", async () => {
      const harness = setup();
      harness.fetchUsage
        .mockResolvedValueOnce(usage([sessionWindow(10)]))
        .mockImplementation(() => new Promise<ProviderUsage>(() => {}));
      harness.scheduler.start();

      await advance(0);
      expect(harness.states.at(-1)?.state).toMatchObject({ kind: "ok" });
      expect(harness.states.at(-1)?.state).not.toHaveProperty("staleSince");

      await advance(120_000);
      expect(harness.states.at(-1)?.state).toMatchObject({
        kind: "ok",
        staleSince: "2026-01-01T00:00:00.000Z",
      });

      harness.scheduler.stop();
    });

    it("does not dim a reading that keeps refreshing", async () => {
      const harness = setup();
      harness.scheduler.start();

      await advance(0);
      await advance(300_000);

      for (const entry of harness.states) {
        expect(entry.state).not.toHaveProperty("staleSince");
      }

      harness.scheduler.stop();
    });
  });

  it("exposes the current state per provider", async () => {
    const harness = setup();
    harness.scheduler.start();
    await advance(0);

    expect(harness.scheduler.snapshot()).toEqual([
      {
        providerId: "claude",
        state: { kind: "ok", usage: usage([sessionWindow(10)]) },
      },
    ]);

    harness.scheduler.stop();
  });
});
