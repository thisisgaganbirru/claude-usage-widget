/**
 * Shared TypeScript types across main and renderer processes
 */

export interface UsageData {
  // 5-hour rolling window (current session)
  currentUsage: number; // five_hour.utilization (0-100 %)
  planLimit: number; // Always 100 (utilization is already %)
  percentageUsed: number; // five_hour.utilization
  resetTime: Date; // five_hour.resets_at
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

export interface UsageSnapshot {
  id?: number;
  timestamp: number;
  currentUsage: number;
  planLimit: number;
  percentageUsed: number;
  planType: string;
  modelInfo: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  sessionCookie: string | null;
  expiresAt: number | null;
}

export interface WidgetSettings {
  pollingInterval: number; // in seconds (30-300)
  notificationThresholds: number[]; // [50, 75, 90, 95]
  enableNotifications: boolean;
  startOnBoot: boolean;
  theme: "light" | "dark" | "auto";
}

export interface IpcMessage {
  channel: string;
  data?: any;
}
