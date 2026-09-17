/**
 * Polls every enabled provider on its own timer (phase P1b).
 *
 * Replaces `usage-poller.ts`, which held one Claude-shaped loop and kept its
 * "already alerted" set in memory next to the timer. That coupling is why
 * moving the polling slider re-fired every notification: changing the interval
 * rebuilt the loop, and the set went with it. Here the alert state is keyed by
 * `provider:window`, lives in a store, and is only ever cleared by the window
 * rolling over.
 *
 * Electron is injected through `SchedulerHost` rather than imported, so the
 * whole retry, jitter, suspend and threshold policy is reachable from tests
 * under fake timers.
 */
import { EventEmitter } from "node:events";
import { createLogger } from "@main/logging/logger";
import type { UsageProvider } from "@main/providers/types";
import { ProviderError, toProviderError } from "@main/providers/types";
import type { ThresholdCrossedEvent, WidgetSettings } from "@shared/types";
import {
  topLevelWindows,
  type ProviderId,
  type ProviderState,
  type ProviderUsage,
  type UsageWindow,
} from "@shared/usage";

const log = createLogger("scheduler");

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 300_000;
const RATE_LIMIT_FALLBACK_MS = 900_000;
/** A poll this soon after a resume or an unlock counts as "immediately". */
const RESUME_DELAY_MS = 250;
const JITTER_FRACTION = 0.1;
/** A reading older than this many intervals is shown dimmed rather than fresh. */
const STALE_INTERVAL_MULTIPLE = 2;

export interface SchedulerHostHandlers {
  /** Machine suspended or the screen locked. */
  onSuspend(): void;
  /** Machine resumed or the screen unlocked. */
  onResume(): void;
  onOnline(): void;
  onOffline(): void;
}

/** Everything the scheduler needs from Electron and the clock. */
export interface SchedulerHost {
  now(): number;
  isOnline(): boolean;
  /** Attaches power and network listeners. Returns a teardown. */
  subscribe(handlers: SchedulerHostHandlers): () => void;
}

/** Which thresholds have already alerted, for one `provider:window`. */
export interface ThresholdRecord {
  /** The window instance these belong to; a new value means a new window. */
  resetsAt: string | null;
  fired: number[];
}

export interface ThresholdStore {
  read(): Record<string, ThresholdRecord>;
  write(state: Record<string, ThresholdRecord>): void;
}

export interface SchedulerOptions {
  host: SchedulerHost;
  getSettings(): WidgetSettings;
  getProvider(id: ProviderId): UsageProvider | null;
  thresholds: ThresholdStore;
}

interface Runtime {
  timer: ReturnType<typeof setTimeout> | null;
  staleTimer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
  failureCount: number;
  state: ProviderState;
}

function thresholdKey(providerId: ProviderId, windowId: string): string {
  return `${providerId}:${windowId}`;
}

/** ±10% so N providers on the same interval never fire together. */
export function applyJitter(delayMs: number, random: number): number {
  const spread = delayMs * JITTER_FRACTION;
  return Math.max(0, Math.round(delayMs + (random * 2 - 1) * spread));
}

export function backoffDelayMs(failureCount: number): number {
  const exponent = Math.max(0, failureCount - 1);
  return Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_MAX_MS);
}

export class Scheduler extends EventEmitter {
  private readonly host: SchedulerHost;
  private readonly getSettings: () => WidgetSettings;
  private readonly lookupProvider: (id: ProviderId) => UsageProvider | null;
  private readonly thresholds: ThresholdStore;

  private readonly runtimes = new Map<ProviderId, Runtime>();
  private unsubscribeHost: (() => void) | null = null;
  private running = false;
  private paused = false;

  constructor(options: SchedulerOptions) {
    super();
    this.host = options.host;
    this.getSettings = options.getSettings;
    this.lookupProvider = options.getProvider;
    this.thresholds = options.thresholds;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = !this.host.isOnline();

    this.unsubscribeHost = this.host.subscribe({
      onSuspend: () => this.pause("suspend"),
      onResume: () => this.resume("resume"),
      onOnline: () => this.resume("online"),
      onOffline: () => this.pause("offline"),
    });

    for (const id of this.enabledProviderIds()) {
      this.schedule(id, 0);
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    for (const id of [...this.runtimes.keys()]) this.clearTimers(id);
    this.unsubscribeHost?.();
    this.unsubscribeHost = null;
  }

  /** Current state per provider, for a renderer that just connected. */
  snapshot(): Array<{ providerId: ProviderId; state: ProviderState }> {
    return [...this.runtimes.entries()].map(([providerId, runtime]) => ({
      providerId,
      state: runtime.state,
    }));
  }

  /**
   * Poll now. A poll already running is awaited rather than duplicated, so
   * hammering the refresh button produces one request, not one per click.
   */
  async refresh(providerId?: ProviderId): Promise<void> {
    const targets =
      providerId === undefined ? this.enabledProviderIds() : [providerId];
    await Promise.all(targets.map((id) => this.poll(id)));
  }

  /**
   * Re-read settings after the user changed them: start what is newly enabled,
   * stop what is newly disabled, and re-time the rest. Threshold state is
   * untouched, so changing an interval never re-fires an alert.
   */
  applySettings(): void {
    if (!this.running) return;
    const enabled = new Set(this.enabledProviderIds());

    for (const id of [...this.runtimes.keys()]) {
      if (enabled.has(id)) continue;
      this.clearTimers(id);
      this.runtimes.delete(id);
    }

    for (const id of enabled) {
      if (this.runtimes.has(id)) {
        // Re-time against the new interval without disturbing the reading.
        this.schedule(id, this.intervalMsFor(id));
      } else {
        this.schedule(id, 0);
      }
    }
  }

  private enabledProviderIds(): ProviderId[] {
    const settings = this.getSettings();
    return (Object.keys(settings.providers) as ProviderId[]).filter((id) => {
      if (!settings.providers[id].enabled) return false;
      return this.lookupProvider(id) !== null;
    });
  }

  private intervalMsFor(id: ProviderId): number {
    const settings = this.getSettings();
    const provider = this.lookupProvider(id);
    const seconds =
      settings.providers[id]?.intervalSec ?? provider?.defaultIntervalSec ?? 60;
    return seconds * 1000;
  }

  private runtimeFor(id: ProviderId): Runtime {
    let runtime = this.runtimes.get(id);
    if (runtime === undefined) {
      runtime = {
        timer: null,
        staleTimer: null,
        inFlight: null,
        failureCount: 0,
        state: { kind: "not-detected" },
      };
      this.runtimes.set(id, runtime);
    }
    return runtime;
  }

  private clearTimers(id: ProviderId): void {
    const runtime = this.runtimes.get(id);
    if (runtime === undefined) return;
    if (runtime.timer !== null) clearTimeout(runtime.timer);
    if (runtime.staleTimer !== null) clearTimeout(runtime.staleTimer);
    runtime.timer = null;
    runtime.staleTimer = null;
  }

  private schedule(id: ProviderId, delayMs: number): void {
    const runtime = this.runtimeFor(id);
    if (runtime.timer !== null) clearTimeout(runtime.timer);
    if (!this.running) return;

    // An immediate poll is immediate: jitter exists to spread recurring
    // timers, not to delay the first read or a resume.
    const delay = delayMs === 0 ? 0 : applyJitter(delayMs, Math.random());
    runtime.timer = setTimeout(() => {
      runtime.timer = null;
      void this.poll(id);
    }, delay);
  }

  private pause(reason: string): void {
    if (this.paused) return;
    this.paused = true;
    log.info("polling paused", { reason });
    for (const id of [...this.runtimes.keys()]) this.clearTimers(id);
  }

  private resume(reason: string): void {
    if (!this.running) return;
    if (!this.paused && reason !== "resume") return;
    this.paused = false;
    log.info("polling resumed", { reason });
    for (const id of this.enabledProviderIds()) {
      this.schedule(id, RESUME_DELAY_MS);
    }
  }

  private poll(id: ProviderId): Promise<void> {
    const runtime = this.runtimeFor(id);
    if (runtime.inFlight !== null) return runtime.inFlight;

    const run = this.runPoll(id, runtime).finally(() => {
      runtime.inFlight = null;
    });
    runtime.inFlight = run;
    return run;
  }

  private async runPoll(id: ProviderId, runtime: Runtime): Promise<void> {
    const provider = this.lookupProvider(id);
    if (provider === null) return;
    if (this.paused) return;

    try {
      const credential = await provider.discoverCredentials();
      if (credential === null) {
        // A provider with a login flow is waiting for the user; one without
        // simply has no vendor tooling on this machine.
        this.emitState(
          id,
          provider.login === undefined
            ? { kind: "not-detected" }
            : {
                kind: "needs-auth",
                hint: `Sign in to ${provider.displayName}.`,
              },
        );
        this.clearTimers(id);
        return;
      }

      const usage = await provider.fetchUsage(credential);
      runtime.failureCount = 0;
      this.emitState(id, { kind: "ok", usage });
      this.checkThresholds(id, usage);
      this.scheduleStaleCheck(id, usage);
      this.schedule(id, this.intervalMsFor(id));
    } catch (error) {
      this.handleFailure(id, runtime, toProviderError(error));
    }
  }

  private handleFailure(
    id: ProviderId,
    runtime: Runtime,
    error: ProviderError,
  ): void {
    log.warn("poll failed", { provider: id, kind: error.kind });

    if (error.kind === "auth") {
      // Retrying a dead credential just burns requests until the user acts.
      this.clearTimers(id);
      runtime.failureCount = 0;
      this.emitState(id, {
        kind: "needs-auth",
        hint: "The saved session expired. Sign in again.",
      });
      return;
    }

    let delayMs: number;
    if (error.kind === "rate-limited") {
      delayMs =
        error.retryAfterSec !== null
          ? error.retryAfterSec * 1000
          : RATE_LIMIT_FALLBACK_MS;
      runtime.failureCount = 0;
    } else if (error.kind === "schema") {
      // The vendor changed a shape. Backing off would hide a recovery, and the
      // response is cheap, so keep the normal cadence and show the code.
      delayMs = this.intervalMsFor(id);
      runtime.failureCount = 0;
    } else {
      runtime.failureCount += 1;
      delayMs = backoffDelayMs(runtime.failureCount);
    }

    this.emitState(id, {
      kind: "error",
      code: error.kind,
      message: error.message,
      retryAt: new Date(this.host.now() + delayMs).toISOString(),
    });
    this.schedule(id, delayMs);
  }

  private scheduleStaleCheck(id: ProviderId, usage: ProviderUsage): void {
    const runtime = this.runtimeFor(id);
    if (runtime.staleTimer !== null) clearTimeout(runtime.staleTimer);
    const after = this.intervalMsFor(id) * STALE_INTERVAL_MULTIPLE;
    runtime.staleTimer = setTimeout(() => {
      runtime.staleTimer = null;
      if (runtime.state.kind !== "ok") return;
      this.emitState(id, {
        kind: "ok",
        usage: runtime.state.usage,
        staleSince: usage.fetchedAt,
      });
    }, after);
  }

  private emitState(id: ProviderId, state: ProviderState): void {
    this.runtimeFor(id).state = state;
    this.emit("state", { providerId: id, state });
  }

  private checkThresholds(id: ProviderId, usage: ProviderUsage): void {
    const settings = this.getSettings();
    const configured = settings.providers[id]?.thresholds ?? [];
    if (configured.length === 0) return;

    const notify =
      settings.enableDesktopNotifications || settings.enableBannerNotifications;

    const stored = this.thresholds.read();
    const next = { ...stored };
    let changed = false;
    const events: ThresholdCrossedEvent[] = [];

    // Per-model windows are a breakdown of a window that already alerts, so
    // alerting on both would double every notification.
    for (const window of topLevelWindows(usage.windows)) {
      const key = thresholdKey(id, window.id);
      const previous = stored[key];
      const fired =
        previous !== undefined && previous.resetsAt === window.resetsAt
          ? [...previous.fired]
          : [];

      const crossed = this.crossedThresholds(window, configured, fired);
      for (const threshold of crossed) {
        fired.push(threshold);
        events.push({
          providerId: id,
          windowId: window.id,
          windowLabel: window.label,
          threshold,
          usedPercent: window.usedPercent,
        });
      }

      // Dropping back below the lowest threshold means the window is being
      // consumed again from a low base; re-arm so the next crossing alerts.
      const retained =
        window.usedPercent < configured[0]
          ? []
          : fired.filter((value) => configured.includes(value));

      if (
        previous === undefined ||
        previous.resetsAt !== window.resetsAt ||
        retained.length !== previous.fired.length ||
        retained.some((value, index) => value !== previous.fired[index])
      ) {
        changed = true;
      }
      next[key] = { resetsAt: window.resetsAt, fired: retained };
    }

    if (changed) this.thresholds.write(next);
    if (!notify) return;
    for (const event of events) this.emit("threshold", event);
  }

  private crossedThresholds(
    window: UsageWindow,
    configured: number[],
    fired: number[],
  ): number[] {
    const crossed: number[] = [];
    for (const threshold of configured) {
      if (window.usedPercent < threshold) continue;
      if (fired.includes(threshold)) continue;
      crossed.push(threshold);
    }
    return crossed;
  }
}
