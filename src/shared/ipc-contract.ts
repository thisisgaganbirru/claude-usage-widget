/**
 * The contract between the renderer and the main process.
 *
 * The renderer never sees `ipcRenderer`. It gets the object described here and
 * nothing else, so the attack surface of a compromised renderer is exactly the
 * list of operations below, with the argument types below, rather than "any
 * channel with any payload".
 *
 * Both sides import these types: the preload implements the interface, and the
 * main process declares its handlers against the same result shapes, so a
 * handler that stops matching the contract is a build error rather than an
 * `undefined` at runtime.
 */
import type {
  AuthExpiredEvent,
  LoginFailureReason,
  ProviderAccount,
  ProviderType,
  ThresholdCrossedEvent,
  UsageData,
  WidgetSettings,
} from "./types";

export interface AuthLoginResult {
  success: boolean;
  isAuthenticated: boolean;
  provider: ProviderType;
  reason?: LoginFailureReason;
  message?: string;
}

export interface AuthLogoutResult {
  success: boolean;
  provider: ProviderType;
}

export interface AuthLogoutEverywhereResult {
  success: boolean;
}

export interface AuthSessionResult {
  provider: ProviderType;
  isAuthenticated: boolean;
}

export interface AuthAccountsResult {
  provider: ProviderType | null;
  accounts: ProviderAccount[];
}

export interface AuthSetActiveAccountResult {
  success: boolean;
  provider: ProviderType;
  accountId: string;
}

export interface UsageCurrentResult {
  provider: ProviderType;
  usageData: UsageData | null;
}

export interface PollerStateResult {
  success: boolean;
  isActive: boolean;
  provider?: ProviderType;
}

export interface PollerIntervalResult {
  success: boolean;
  error?: string;
}

export interface SettingsUpdateResult {
  success: boolean;
  settings: WidgetSettings;
}

export interface AppVersionResult {
  version: string;
}

export interface OpenExternalResult {
  opened: boolean;
}

export interface WindowResizeResult {
  success: boolean;
  size?: { width: number; height: number };
}

export interface WindowPinnedResult {
  pinned: boolean;
}

export interface WindowSetPinnedResult {
  success: boolean;
  pinned: boolean;
}

export interface UsageUpdatedEvent {
  usageData: UsageData;
}

export interface PollerErrorEvent {
  provider: ProviderType;
  error: string;
}

export interface LoginWindowOpenedEvent {
  provider: ProviderType;
}

/** Removes the listener it was returned from. Safe to call twice. */
export type Unsubscribe = () => void;

export interface QuotaWidgetApi {
  readonly auth: {
    login(provider: ProviderType): Promise<AuthLoginResult>;
    logout(provider: ProviderType): Promise<AuthLogoutResult>;
    logoutEverywhere(): Promise<AuthLogoutEverywhereResult>;
    checkSession(provider: ProviderType): Promise<AuthSessionResult>;
    listAccounts(provider?: ProviderType): Promise<AuthAccountsResult>;
    setActiveAccount(
      provider: ProviderType,
      accountId: string,
    ): Promise<AuthSetActiveAccountResult>;
  };

  readonly usage: {
    getCurrent(provider: ProviderType): Promise<UsageCurrentResult>;
  };

  readonly poller: {
    start(provider: ProviderType): Promise<PollerStateResult>;
    stop(): Promise<PollerStateResult>;
    setInterval(seconds: number): Promise<PollerIntervalResult>;
  };

  readonly settings: {
    get(): Promise<WidgetSettings>;
    update(patch: Partial<WidgetSettings>): Promise<SettingsUpdateResult>;
  };

  readonly app: {
    getVersion(): Promise<AppVersionResult>;
    quit(): Promise<void>;
    minimize(): Promise<void>;
    /** Resolves with whether the URL passed the main-process allowlist. */
    openExternal(url: string): Promise<OpenExternalResult>;
  };

  readonly window: {
    resize(width: number, height: number): Promise<WindowResizeResult>;
    getPinned(): Promise<WindowPinnedResult>;
    setPinned(pinned: boolean): Promise<WindowSetPinnedResult>;
    /** Fire-and-forget: runs on every mouse move, so it is not an invoke. */
    setIgnoreMouseEvents(ignore: boolean): void;
  };

  readonly events: {
    onUsageUpdated(listener: (event: UsageUpdatedEvent) => void): Unsubscribe;
    onThresholdCrossed(
      listener: (event: ThresholdCrossedEvent) => void,
    ): Unsubscribe;
    onAuthExpired(listener: (event: AuthExpiredEvent) => void): Unsubscribe;
    onLoginSuccess(listener: () => void): Unsubscribe;
    onLoginWindowOpened(
      listener: (event: LoginWindowOpenedEvent) => void,
    ): Unsubscribe;
    onPollerError(listener: (event: PollerErrorEvent) => void): Unsubscribe;
    onRefreshNow(listener: () => void): Unsubscribe;
    onOpenSettings(listener: () => void): Unsubscribe;
  };
}
