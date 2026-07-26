import { EventEmitter } from "events";
import isDev from "electron-is-dev";
import {
  AuthExpiredEvent,
  ProviderType,
  ThresholdCrossedEvent,
  UsageData,
} from "@shared/types";
import { fetchUsageData } from "./usage-fetcher";
import { SessionManager } from "@main/auth/session-manager";
import { SettingsManager } from "@main/settings/settings-manager";

const PROVIDERS: ProviderType[] = ["claude", "chatgpt"];

interface ProviderPollState {
  pollingTimeout: ReturnType<typeof setTimeout> | null;
  isPolling: boolean;
  isPollInFlight: boolean;
  transientFailureCount: number;
  lastUsageData: UsageData | null;
  notifiedSessionThresholds: Set<number>;
  notifiedWeeklyThresholds: Set<number>;
}

function createProviderState(): ProviderPollState {
  return {
    pollingTimeout: null,
    isPolling: false,
    isPollInFlight: false,
    transientFailureCount: 0,
    lastUsageData: null,
    notifiedSessionThresholds: new Set(),
    notifiedWeeklyThresholds: new Set(),
  };
}

export class UsagePoller extends EventEmitter {
  private pollDuration: number = 60000;
  private activeProvider: ProviderType = "claude";
  private providerStates: Record<ProviderType, ProviderPollState> = {
    claude: createProviderState(),
    chatgpt: createProviderState(),
  };

  constructor(pollDurationSeconds: number = 60) {
    super();
    this.pollDuration = pollDurationSeconds * 1000;
  }

  setProvider(provider: ProviderType): void {
    this.activeProvider = provider;
    if (isDev) console.log(`[UsagePoller] Active provider set to ${provider}`);
  }

  getProvider(): ProviderType {
    return this.activeProvider;
  }

  start(provider?: ProviderType): void {
    const target = provider ?? this.activeProvider;
    this.setProvider(target);
    const state = this.providerStates[target];

    if (state.isPolling) {
      if (isDev) console.log(`[UsagePoller] ${target} polling already active`);
      return;
    }

    if (isDev) {
      console.log(
        `[UsagePoller] Starting polling for ${target} (interval: ${this.pollDuration}ms)`,
      );
    }
    state.isPolling = true;
    state.transientFailureCount = 0;
    this.scheduleNextPoll(target, 0);
  }

  stop(provider?: ProviderType): void {
    if (provider) {
      this.stopProvider(provider);
      return;
    }

    for (const target of PROVIDERS) {
      this.stopProvider(target);
    }
  }

  setPollingInterval(seconds: number): void {
    if (seconds < 30 || seconds > 300) {
      console.warn(
        "[UsagePoller] Invalid polling interval. Must be between 30-300 seconds",
      );
      return;
    }

    this.pollDuration = seconds * 1000;
    for (const provider of PROVIDERS) {
      if (this.providerStates[provider].isPolling) {
        this.scheduleNextPoll(provider, this.pollDuration);
      }
    }
  }

  async refreshNow(provider?: ProviderType): Promise<void> {
    const target = provider ?? this.activeProvider;
    this.setProvider(target);
    const state = this.providerStates[target];
    if (!state.isPolling) {
      await this.poll(target, true);
      return;
    }
    this.scheduleNextPoll(target, 0);
  }

  getLastUsageData(provider: ProviderType): UsageData | null {
    return this.providerStates[provider].lastUsageData;
  }

  isActive(provider?: ProviderType): boolean {
    if (provider) return this.providerStates[provider].isPolling;
    return PROVIDERS.some((target) => this.providerStates[target].isPolling);
  }

  private stopProvider(provider: ProviderType): void {
    const state = this.providerStates[provider];
    if (isDev && state.isPolling) {
      console.log(`[UsagePoller] Stopping polling for ${provider}`);
    }
    this.clearScheduledPoll(provider);
    state.isPolling = false;
    state.isPollInFlight = false;
    state.transientFailureCount = 0;
    state.notifiedSessionThresholds.clear();
    state.notifiedWeeklyThresholds.clear();
  }

  private async poll(provider: ProviderType, force: boolean = false): Promise<void> {
    const state = this.providerStates[provider];
    if ((!state.isPolling && !force) || state.isPollInFlight) return;
    state.isPollInFlight = true;
    let nextDelay = this.pollDuration;

    try {
      const sessionCookie = SessionManager.getSessionCookie(provider);
      if (!sessionCookie) {
        const event: AuthExpiredEvent = {
          provider,
          reason: "missing_session",
          message: `No saved ${provider} session token was found.`,
        };
        this.emit("authExpired", event);
        this.stopProvider(provider);
        return;
      }

      const usageData = await fetchUsageData(sessionCookie, provider);
      state.lastUsageData = usageData;
      this.emit("usageUpdate", usageData);
      this.checkThresholds(usageData);
      state.transientFailureCount = 0;

      if (isDev) {
        console.log(
          `[UsagePoller] ${provider} usage: ${usageData.currentUsage}/${usageData.planLimit} (${usageData.percentageUsed.toFixed(1)}%)`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("401") ||
        message.includes("403") ||
        message.includes("Authentication failed")
      ) {
        SessionManager.clearSession(provider);
        const event: AuthExpiredEvent = {
          provider,
          reason: "server_auth_failed",
          message:
            provider === "chatgpt"
              ? "Session expired on ChatGPT. Please log in again."
              : "Session expired on Claude.ai. Please log in again.",
        };
        this.emit("authExpired", event);
        this.stopProvider(provider);
        return;
      }

      console.error(`[UsagePoller] ${provider} poll failed:`, message);
      state.transientFailureCount += 1;
      nextDelay = this.getRetryDelayMs(state.transientFailureCount);
      this.emit("pollError", {
        provider,
        error: new Error(`${message} (retrying in ${Math.round(nextDelay / 1000)}s)`),
      });
    } finally {
      state.isPollInFlight = false;
      if (state.isPolling && !force) {
        this.scheduleNextPoll(provider, nextDelay);
      }
    }
  }

  private getRetryDelayMs(transientFailureCount: number): number {
    const baseMs = 5000;
    const exponent = Math.max(0, transientFailureCount - 1);
    const backoffMs = baseMs * Math.pow(2, exponent);
    return Math.min(backoffMs, 300000);
  }

  private clearScheduledPoll(provider: ProviderType): void {
    const state = this.providerStates[provider];
    if (!state.pollingTimeout) return;
    clearTimeout(state.pollingTimeout);
    state.pollingTimeout = null;
  }

  private scheduleNextPoll(provider: ProviderType, delayMs: number): void {
    const state = this.providerStates[provider];
    this.clearScheduledPoll(provider);
    if (!state.isPolling) return;
    state.pollingTimeout = setTimeout(() => {
      void this.poll(provider);
    }, delayMs);
  }

  private checkThresholds(usageData: UsageData): void {
    const settings = SettingsManager.get();
    const state = this.providerStates[usageData.provider];
    if (!settings.enableDesktopNotifications && !settings.enableBannerNotifications) {
      state.notifiedSessionThresholds.clear();
      state.notifiedWeeklyThresholds.clear();
      return;
    }

    this.checkSessionThresholds(usageData, this.getThresholds(settings.notificationThresholds));
    this.checkWeeklyThresholds(
      usageData,
      this.getThresholds(settings.weeklyNotificationThresholds),
    );
  }

  private getThresholds(values: number[]): number[] {
    return Array.from(
      new Set(values.filter((value) => Number.isFinite(value) && value > 0 && value <= 100)),
    ).sort((a, b) => a - b);
  }

  private checkSessionThresholds(
    usageData: UsageData,
    sessionThresholds: number[],
  ): void {
    const state = this.providerStates[usageData.provider];
    if (sessionThresholds.length === 0) {
      state.notifiedSessionThresholds.clear();
      return;
    }

    const configuredThresholds = new Set(sessionThresholds);
    state.notifiedSessionThresholds.forEach((value) => {
      if (!configuredThresholds.has(value)) state.notifiedSessionThresholds.delete(value);
    });

    const percentage = usageData.percentageUsed;
    for (const threshold of sessionThresholds) {
      if (percentage >= threshold && !state.notifiedSessionThresholds.has(threshold)) {
        state.notifiedSessionThresholds.add(threshold);
        const event: ThresholdCrossedEvent = {
          provider: usageData.provider,
          threshold,
          percentage,
          scope: "session",
          usageData,
        };
        this.emit("thresholdCrossed", event);
      }
    }

    if (percentage < sessionThresholds[0]) state.notifiedSessionThresholds.clear();
  }

  private checkWeeklyThresholds(
    usageData: UsageData,
    weeklyThresholds: number[],
  ): void {
    const state = this.providerStates[usageData.provider];
    if (weeklyThresholds.length === 0) {
      state.notifiedWeeklyThresholds.clear();
      return;
    }

    const configuredThresholds = new Set(weeklyThresholds);
    state.notifiedWeeklyThresholds.forEach((value) => {
      if (!configuredThresholds.has(value)) state.notifiedWeeklyThresholds.delete(value);
    });

    const percentage = Math.min(100, Math.max(0, usageData.sevenDayUsage));
    for (const threshold of weeklyThresholds) {
      if (percentage >= threshold && !state.notifiedWeeklyThresholds.has(threshold)) {
        state.notifiedWeeklyThresholds.add(threshold);
        const event: ThresholdCrossedEvent = {
          provider: usageData.provider,
          threshold,
          percentage,
          scope: "weekly",
          usageData,
        };
        this.emit("thresholdCrossed", event);
      }
    }

    if (percentage < weeklyThresholds[0]) state.notifiedWeeklyThresholds.clear();
  }
}
