/**
 * Shared types across main and renderer processes.
 *
 * The usage model itself lives in `./usage.ts`. What is left here is the
 * app's own state: accounts, settings, and the events the main process
 * pushes to the renderer.
 */
import type { ProviderId } from "./usage";

/**
 * Providers whose credential this app captures itself, through a sign-in
 * window, rather than reading one a vendor CLI already wrote to disk. Only
 * these have accounts, a login flow and a logout.
 */
export type ProviderType = Extract<ProviderId, "claude" | "chatgpt">;

export interface ProviderAccount {
  id: string;
  provider: ProviderType;
  displayName: string;
  email?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export const SETTINGS_VERSION = 2;

/** Per-provider polling and alerting. Absent providers are simply not polled. */
export interface ProviderSettings {
  enabled: boolean;
  /** Seconds between polls, clamped to POLLING_INTERVAL_{MIN,MAX}_SEC. */
  intervalSec: number;
  /** Percentages that raise an alert, applied to every window this provider reports. */
  thresholds: number[];
}

export interface WidgetSettings {
  version: typeof SETTINGS_VERSION;
  providers: Record<ProviderId, ProviderSettings>;
  enableDesktopNotifications: boolean;
  enableBannerNotifications: boolean;
  startOnBoot: boolean;
  keepInTray: boolean;
  quickEntryShortcut: string;
  theme: "light" | "dark" | "auto";
}

/**
 * What the renderer is allowed to change, and at what granularity.
 *
 * `providers` is partial twice over on purpose: the renderer may send one
 * provider, and within it one field. Sending a whole `ProviderSettings` block
 * to move a single slider would make every other field in that block a
 * write too, so a stale renderer would quietly revert whatever it last read.
 */
export interface SettingsPatch extends Partial<
  Omit<WidgetSettings, "version" | "providers">
> {
  providers?: Partial<Record<ProviderId, Partial<ProviderSettings>>>;
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
  providerId: ProviderId;
  /** The window that crossed, e.g. "session" or "weekly". */
  windowId: string;
  /** The window's own label, used verbatim in the notification. */
  windowLabel: string;
  threshold: number;
  usedPercent: number;
}
