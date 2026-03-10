import { EventEmitter } from "events";
import isDev from "electron-is-dev";
import { UsageData } from "@shared/types";
import { fetchUsageData } from "./usage-fetcher";
import { SessionManager } from "@main/auth/session-manager";

export class UsagePoller extends EventEmitter {
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private pollDuration: number = 60000; // 60 seconds default
  private isPolling: boolean = false;
  private lastUsageData: UsageData | null = null;
  private notifiedThresholds: Set<number> = new Set();

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

    // Poll immediately first, then set interval
    this.poll();
    this.pollingInterval = setInterval(() => this.poll(), this.pollDuration);
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.pollingInterval) {
      if (isDev) console.log("[UsagePoller] Stopping polling");
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.isPolling = false;
      this.notifiedThresholds.clear();
    }
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
    await this.poll();
  }

  /**
   * Execute a single poll
   */
  private async poll(): Promise<void> {
    try {
      const sessionCookie = SessionManager.getSessionCookie();

      if (!sessionCookie) {
        this.emit("authExpired");
        this.stop();
        return;
      }

      const usageData = await fetchUsageData(sessionCookie);
      this.lastUsageData = usageData;
      this.emit("usageUpdate", usageData);
      this.checkThresholds(usageData);

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
        this.emit("authExpired");
        this.stop();
        return;
      }

      console.error("[UsagePoller] Poll failed:", message);
      this.emit("pollError", error);
    }
  }

  /**
   * Check if usage has crossed notification thresholds
   */
  private checkThresholds(usageData: UsageData): void {
    const thresholds = [50, 75, 90, 95];
    const percentage = usageData.percentageUsed;

    for (const threshold of thresholds) {
      if (percentage >= threshold && !this.notifiedThresholds.has(threshold)) {
        this.notifiedThresholds.add(threshold);
        this.emit("thresholdCrossed", { threshold, percentage, usageData });
      }
    }

    // Reset thresholds if usage dropped below 50% (new cycle)
    if (percentage < 50) {
      this.notifiedThresholds.clear();
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
