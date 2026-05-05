import { EventEmitter } from "events";
import isDev from "electron-is-dev";
import { AuthExpiredEvent, ProviderType, ThresholdCrossedEvent, UsageData } from "@shared/types";
import { fetchUsageData } from "./usage-fetcher";
import { SessionManager } from "@main/auth/session-manager";

const DEFAULT_SESSION_THRESHOLDS = [50, 75, 90, 95];
const DEFAULT_WEEKLY_THRESHOLDS = [50, 75, 90, 100];

export class UsagePoller extends EventEmitter {
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private pollDuration: number = 60000;
  private isPolling: boolean = false;
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
        `[UsagePoller] Starting polling for ${this.activeProvider} (interval ${this.pollDuration}ms)`,
      );
    }
    this.isPolling = true;
    void this.poll();
    this.pollingInterval = setInterval(() => {
      void this.poll();
    }, this.pollDuration);
  }

  stop(): void {
    if (!this.pollingInterval) {
      this.isPolling = false;
      return;
    }
    clearInterval(this.pollingInterval);
    this.pollingInterval = null;
    this.isPolling = false;
  }

  setPollingInterval(seconds: number): void {
    if (seconds < 30 || seconds > 300) return;
    const wasPolling = this.isPolling;
    if (wasPolling) this.stop();
    this.pollDuration = seconds * 1000;
    if (wasPolling) this.start();
  }

  async refreshNow(provider?: ProviderType): Promise<void> {
    if (provider) this.setProvider(provider);
    await this.poll();
  }

  private async poll(): Promise<void> {
    const provider = this.activeProvider;
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

      this.emit("pollError", new Error(message));
    }
  }

  private checkThresholds(usageData: UsageData): void {
    const provider = usageData.provider;
    const sessionNotified = this.notifiedSessionThresholdsByProvider[provider];
    const weeklyNotified = this.notifiedWeeklyThresholdsByProvider[provider];
    const sessionPct = usageData.percentageUsed;
    const weeklyPct = usageData.sevenDayUsage;

    for (const threshold of DEFAULT_SESSION_THRESHOLDS) {
      if (sessionPct >= threshold && !sessionNotified.has(threshold)) {
        sessionNotified.add(threshold);
        const event: ThresholdCrossedEvent = {
          provider,
          threshold,
          percentage: sessionPct,
          scope: "session",
          usageData,
        };
        this.emit("thresholdCrossed", event);
      }
    }
    if (sessionPct < DEFAULT_SESSION_THRESHOLDS[0]) {
      sessionNotified.clear();
    }

    for (const threshold of DEFAULT_WEEKLY_THRESHOLDS) {
      if (weeklyPct >= threshold && !weeklyNotified.has(threshold)) {
        weeklyNotified.add(threshold);
        const event: ThresholdCrossedEvent = {
          provider,
          threshold,
          percentage: weeklyPct,
          scope: "weekly",
          usageData,
        };
        this.emit("thresholdCrossed", event);
      }
    }
    if (weeklyPct < DEFAULT_WEEKLY_THRESHOLDS[0]) {
      weeklyNotified.clear();
    }
  }

  getLastUsageData(provider: ProviderType): UsageData | null {
    return this.lastUsageDataByProvider[provider] ?? null;
  }

  isActive(): boolean {
    return this.isPolling;
  }
}
