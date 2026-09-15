/**
 * Shared TypeScript types across main and renderer processes
 */

export type ProviderType = "claude" | "chatgpt";

export interface UsageData {
  provider: ProviderType;
  // 5-hour rolling window (current session)
  currentUsage: number; // five_hour.utilization (0-100 %)
  planLimit: number; // Always 100 (utilization is already %)
  percentageUsed: number; // five_hour.utilization
  resetTime: Date | null; // five_hour.resets_at — null when no active session
  sessionActive: boolean; // true when five_hour exists in API response

  // 7-day rolling window
  sevenDayUsage: number; // seven_day.utilization (0-100 %)
  sevenDayResetTime: Date; // seven_day.resets_at

  // Per-model 7-day utilization (null if not tracked / not on Pro)
  opusUsage: number | null; // seven_day_opus.utilization
  sonnetUsage: number | null; // seven_day_sonnet.utilization

  planType: string; // "Pro" | "Pro+" (extra_usage.is_enabled)
  modelInfo: string; // Derived from which model has usage
  userName: string; // Org name from /api/organizations
  timestamp: Date;
}

export interface ProviderAccount {
  id: string;
  provider: ProviderType;
  displayName: string;
  email?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WidgetSettings {
  pollingInterval: number; // in seconds (30-300)
  notificationThresholds: number[]; // [50, 75, 90, 95]
  weeklyNotificationThresholds: number[]; // [50, 75, 90, 100]
  enableDesktopNotifications: boolean;
  enableBannerNotifications: boolean;
  startOnBoot: boolean;
  keepInTray: boolean;
  quickEntryShortcut: string;
  theme: "light" | "dark" | "auto";
}

export type LoginFailureReason =
  | "cancelled"
  | "token_missing"
  | "login_failed"
  /** Signed in fine, but the OS keychain would not store the secret. */
  | "storage_unavailable";

export interface AuthExpiredEvent {
  provider: ProviderType;
  reason: "missing_session" | "server_auth_failed";
  message: string;
}

export interface ThresholdCrossedEvent {
  provider: ProviderType;
  threshold: number;
  percentage: number;
  scope: "session" | "weekly";
  usageData: UsageData;
}
