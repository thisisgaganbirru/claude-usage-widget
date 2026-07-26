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

export class UsagePoller extends EventEmitter {
  private pollingTimeout: ReturnType<typeof setTimeout> | null = null;
  private pollDuration: number = 60000;
  private isPolling: boolean = false;
  private isPollInFlight: boolean = false;
  private transientFailureCount: number = 0;
  private activeProvider: ProviderType = "claude";
  private lastUsageDataByProvider: Partial<Record<ProviderType, UsageData>> = {};
  private notifiedSessionThresholdsByProvider: Record<ProviderType, Set<number>> = {
    claude: new Set(),
    chatgpt: new Set(),
  };
  private notifiedWeeklyThresholdsByProvider: Record<ProviderType, Set<number>> = {
    claude: new Set(),
    chatgpt: new Set(),
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
    if (provider) this.setProvider(provider);
    if (this.isPolling) {
      if (isDev) console.log("[UsagePoller] Polling already in progress");
      return;
    }

    if (isDev) {
      console.log(
        `[UsagePoller] Starting polling for ${this.activeProvider} (interval: ${this.pollDuration}ms)`,
      );
    }
    this.isPolling = true;
    this.transientFailureCount = 0;
    this.scheduleNextPoll(0);
  }

  stop(): void {
    if (isDev) console.log("[UsagePoller] Stopping polling");
    this.clearScheduledPoll();
    this.isPolling = false;
    this.isPollInFlight = false;
    this.transientFailureCount = 0;
    this.notifiedSessionThresholdsByProvider[this.activeProvider].clear();
    this.notifiedWeeklyThresholdsByProvider[this.activeProvider].clear();
  }

  setPollingInterval(seconds: number): void {
    if (seconds < 30 || seconds > 300) {
      console.warn(
        "[UsagePoller] Invalid polling interval. Must be between 30-300 seconds",
      );
      return;
    }
    this.pollDuration = seconds * 1000;
    if (this.isPolling) this.scheduleNextPoll(this.pollDuration);
  }

  async refreshNow(provider?: ProviderType): Promise<void> {
    if (provider) this.setProvider(provider);
    if (!this.isPolling) {
      await this.poll(true);
      return;
    }
    this.scheduleNextPoll(0);
  }

  private async poll(force: boolean = false): Promise<void> {
    if ((!this.isPolling && !force) || this.isPollInFlight) return;
    this.isPollInFlight = true;
    const provider = this.activeProvider;
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
        this.stop();
        return;
      }

      const usageData = await fetchUsageData(sessionCookie, provider);
      this.lastUsageDataByProvider[provider] = usageData;
      this.emit("usageUpdate", usageData);
      this.checkThresholds(usageData);
      this.transientFailureCount = 0;

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
        this.stop();
        return;
      }

      console.error(`[UsagePoller] ${provider} poll failed:`, message);
      this.transientFailureCount += 1;
      nextDelay = this.getRetryDelayMs();
      this.emit(
        "pollError",
        new Error(`${message} (retrying in ${Math.round(nextDelay / 1000)}s)`),
      );
    } finally {
      this.isPollInFlight = false;
      if (this.isPolling && !force) {
        this.scheduleNextPoll(nextDelay);
      }
    }
  }

  private getRetryDelayMs(): number {
    const baseMs = 5000;
    const exponent = Math.max(0, this.transientFailureCount - 1);
    const backoffMs = baseMs * Math.pow(2, exponent);
    return Math.min(backoffMs, 300000);
  }

  private clearScheduledPoll(): void {
    if (!this.pollingTimeout) return;
    clearTimeout(this.pollingTimeout);
    this.pollingTimeout = null;
  }

  private scheduleNextPoll(delayMs: number): void {
    this.clearScheduledPoll();
    if (!this.isPolling) return;
    this.pollingTimeout = setTimeout(() => {
      void this.poll();
    }, delayMs);
  }

  private checkThresholds(usageData: UsageData): void {
    const settings = SettingsManager.get();
    if (!settings.enableDesktopNotifications && !settings.enableBannerNotifications) {
      this.notifiedSessionThresholdsByProvider[usageData.provider].clear();
      this.notifiedWeeklyThresholdsByProvider[usageData.provider].clear();
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
    const notified = this.notifiedSessionThresholdsByProvider[usageData.provider];
    if (sessionThresholds.length === 0) {
      notified.clear();
      return;
    }

    const configuredThresholds = new Set(sessionThresholds);
    notified.forEach((value) => {
      if (!configuredThresholds.has(value)) notified.delete(value);
    });

    const percentage = usageData.percentageUsed;
    for (const threshold of sessionThresholds) {
      if (percentage >= threshold && !notified.has(threshold)) {
        notified.add(threshold);
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

    if (percentage < sessionThresholds[0]) notified.clear();
  }

  private checkWeeklyThresholds(
    usageData: UsageData,
    weeklyThresholds: number[],
  ): void {
    const notified = this.notifiedWeeklyThresholdsByProvider[usageData.provider];
    if (weeklyThresholds.length === 0) {
      notified.clear();
      return;
    }

    const configuredThresholds = new Set(weeklyThresholds);
    notified.forEach((value) => {
      if (!configuredThresholds.has(value)) notified.delete(value);
    });

    const percentage = Math.min(100, Math.max(0, usageData.sevenDayUsage));
    for (const threshold of weeklyThresholds) {
      if (percentage >= threshold && !notified.has(threshold)) {
        notified.add(threshold);
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

    if (percentage < weeklyThresholds[0]) notified.clear();
  }

  getLastUsageData(provider: ProviderType): UsageData | null {
    return this.lastUsageDataByProvider[provider] ?? null;
  }

  isActive(): boolean {
    return this.isPolling;
  }
}
