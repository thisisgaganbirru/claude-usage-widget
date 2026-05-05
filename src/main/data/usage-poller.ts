import { EventEmitter } from "events";
import isDev from "electron-is-dev";
import { UsageData } from "@shared/types";
import { fetchUsageData } from "./usage-fetcher";
import { SessionManager } from "@main/auth/session-manager";
import { SettingsManager } from "@main/settings/settings-manager";

export class UsagePoller extends EventEmitter {
  private pollingTimeout: ReturnType<typeof setTimeout> | null = null;
  private pollDuration: number = 60000; // 60 seconds default
  private isPolling: boolean = false;
  private isPollInFlight: boolean = false;
  private transientFailureCount: number = 0;
  private lastUsageData: UsageData | null = null;
  private notifiedSessionThresholds: Set<number> = new Set();
  private notifiedWeeklyThresholds: Set<number> = new Set();

  constructor(pollDurationSeconds: number = 60) {
    super();
    this.pollDuration = pollDurationSeconds * 1000;
  }

  /**
   * Start polling for usage data
   */
  start(): void {
    if (this.isPolling) {
      console.warn("[UsagePoller] Polling already in progress");
      return;
    }

    if (isDev) console.log(
      `[UsagePoller] Starting polling (interval: ${this.pollDuration}ms)`,
    );
    this.isPolling = true;
    this.transientFailureCount = 0;

    // Poll immediately first
    this.scheduleNextPoll(0);
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (isDev) console.log("[UsagePoller] Stopping polling");
    this.clearScheduledPoll();
    this.isPolling = false;
    this.isPollInFlight = false;
    this.transientFailureCount = 0;
    this.notifiedSessionThresholds.clear();
    this.notifiedWeeklyThresholds.clear();
  }

  /**
   * Set polling interval
   */
  setPollingInterval(seconds: number): void {
    if (seconds < 30 || seconds > 300) {
      console.warn(
        "[UsagePoller] Invalid polling interval. Must be between 30-300 seconds",
      );
      return;
    }

    const wasPolling = this.isPolling;
    if (wasPolling) this.stop();

    this.pollDuration = seconds * 1000;
    if (wasPolling) this.start();

    if (isDev) console.log(`[UsagePoller] Polling interval updated to ${seconds}s`);
  }

  /**
   * Trigger a one-off refresh outside the scheduled interval.
   */
  async refreshNow(): Promise<void> {
    if (!this.isPolling) {
      await this.poll(true);
      return;
    }
    this.scheduleNextPoll(0);
  }

  /**
   * Execute a single poll
   */
  private async poll(force: boolean = false): Promise<void> {
    if ((!this.isPolling && !force) || this.isPollInFlight) return;
    this.isPollInFlight = true;
    let nextDelay = this.pollDuration;

    try {
      const sessionCookie = SessionManager.getSessionCookie();

      if (!sessionCookie) {
        this.emit("authExpired", {
          reason: "missing_session",
          message: "No local session token was found.",
        });
        this.stop();
        return;
      }

      const usageData = await fetchUsageData(sessionCookie);
      this.lastUsageData = usageData;
      this.emit("usageUpdate", usageData);
      this.checkThresholds(usageData);
      this.transientFailureCount = 0;

      if (isDev) console.log(
        `[UsagePoller] Usage: ${usageData.currentUsage}/${usageData.planLimit} (${usageData.percentageUsed.toFixed(1)}%)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Auth errors mean the session expired on Anthropic's side — not just a network blip.
      // Clear local session and stop polling so the renderer shows LoginView.
      if (
        message.includes("401") ||
        message.includes("403") ||
        message.includes("Authentication failed")
      ) {
        console.warn(
          "[UsagePoller] Auth error — session expired on server. Clearing and stopping.",
        );
        SessionManager.clearSession();
        this.emit("authExpired", {
          reason: "server_auth_failed",
          message: "Session expired on Claude.ai. Please log in again.",
        });
        this.stop();
        return;
      }

      console.error("[UsagePoller] Poll failed:", message);
      this.transientFailureCount += 1;
      nextDelay = this.getRetryDelayMs();
      this.emit(
        "pollError",
        new Error(
          `${message} (retrying in ${Math.round(nextDelay / 1000)}s)`,
        ),
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

  /**
   * Check if usage has crossed notification thresholds
   */
  private checkThresholds(usageData: UsageData): void {
    const settings = SettingsManager.get();
    const sessionThresholds = Array.from(
      new Set(
        settings.notificationThresholds.filter(
          (value) => Number.isFinite(value) && value > 0 && value <= 100,
        ),
      ),
    ).sort((a, b) => a - b);

    if (!settings.enableDesktopNotifications && !settings.enableBannerNotifications) {
      this.notifiedSessionThresholds.clear();
      this.notifiedWeeklyThresholds.clear();
      return;
    }

    this.checkSessionThresholds(usageData, sessionThresholds);
    this.checkWeeklyThresholds(usageData);
  }

  private checkSessionThresholds(
    usageData: UsageData,
    sessionThresholds: number[],
  ): void {
    if (sessionThresholds.length === 0) {
      this.notifiedSessionThresholds.clear();
      return;
    }

    const configuredThresholds = new Set(sessionThresholds);
    this.notifiedSessionThresholds.forEach((value) => {
      if (!configuredThresholds.has(value)) {
        this.notifiedSessionThresholds.delete(value);
      }
    });

    const sessionPercentage = usageData.percentageUsed;

    for (const threshold of sessionThresholds) {
      if (
        sessionPercentage >= threshold &&
        !this.notifiedSessionThresholds.has(threshold)
      ) {
        this.notifiedSessionThresholds.add(threshold);
        this.emit("thresholdCrossed", {
          threshold,
          percentage: sessionPercentage,
          scope: "session",
          usageData,
        });
      }
    }

    const minThreshold = sessionThresholds[0];
    if (sessionPercentage < minThreshold) {
      this.notifiedSessionThresholds.clear();
    }
  }

  private checkWeeklyThresholds(usageData: UsageData): void {
    const settings = SettingsManager.get();
    const weeklyThresholds = Array.from(
      new Set(
        settings.weeklyNotificationThresholds.filter(
          (value) => Number.isFinite(value) && value > 0 && value <= 100,
        ),
      ),
    ).sort((a, b) => a - b);

    if (weeklyThresholds.length === 0) {
      this.notifiedWeeklyThresholds.clear();
      return;
    }

    const configuredThresholds = new Set(weeklyThresholds);
    this.notifiedWeeklyThresholds.forEach((value) => {
      if (!configuredThresholds.has(value)) {
        this.notifiedWeeklyThresholds.delete(value);
      }
    });

    const weeklyPercentage = Math.min(100, Math.max(0, usageData.sevenDayUsage));

    for (const threshold of weeklyThresholds) {
      if (
        weeklyPercentage >= threshold &&
        !this.notifiedWeeklyThresholds.has(threshold)
      ) {
        this.notifiedWeeklyThresholds.add(threshold);
        this.emit("thresholdCrossed", {
          threshold,
          percentage: weeklyPercentage,
          scope: "weekly",
          usageData,
        });
      }
    }

    if (weeklyPercentage < weeklyThresholds[0]) {
      this.notifiedWeeklyThresholds.clear();
    }
  }

  /**
   * Get current usage data
   */
  getLastUsageData(): UsageData | null {
    return this.lastUsageData;
  }

  /**
   * Check if currently polling
   */
  isActive(): boolean {
    return this.isPolling;
  }
}
