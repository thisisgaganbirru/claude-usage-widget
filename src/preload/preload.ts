/**
 * The preload script: the entire surface the renderer gets.
 *
 * Nothing here hands the renderer a channel name or an `ipcRenderer` handle.
 * It receives the `QuotaWidgetApi` object and nothing else, so an XSS in the
 * renderer can call exactly these operations and no others. Compare the old
 * bridge, which exposed `invoke(channel, ...args)` behind an allowlist: any
 * allowed channel with any payload was reachable from a single injected
 * script.
 *
 * Arguments are also normalized here so the main process sees the shapes its
 * validators expect, and every listener registration returns the function
 * that removes it, which is what lets React effects clean up properly.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

import {
  IPC_INVOKE_CHANNELS,
  IPC_ON_CHANNELS,
  IPC_SEND_CHANNELS,
} from "@shared/ipc-channels";
import type { IpcOnChannel } from "@shared/ipc-channels";
import type {
  AppVersionResult,
  AuthAccountsResult,
  AuthLoginResult,
  AuthLogoutEverywhereResult,
  AuthLogoutResult,
  AuthSessionResult,
  AuthSetActiveAccountResult,
  LoginWindowOpenedEvent,
  OpenExternalResult,
  PollerErrorEvent,
  PollerIntervalResult,
  PollerStateResult,
  QuotaWidgetApi,
  SettingsUpdateResult,
  Unsubscribe,
  UsageCurrentResult,
  UsageUpdatedEvent,
  WindowPinnedResult,
  WindowResizeResult,
  WindowSetPinnedResult,
} from "@shared/ipc-contract";
import type {
  AuthExpiredEvent,
  ProviderType,
  ThresholdCrossedEvent,
  WidgetSettings,
} from "@shared/types";

/**
 * Subscribe to a main-process event and hand back the unsubscribe. The event
 * object itself is never forwarded: the renderer has no business touching an
 * `IpcRendererEvent`, which carries a `sender` back into the IPC layer.
 */
function subscribe<Payload>(
  channel: IpcOnChannel,
  listener: (payload: Payload) => void,
): Unsubscribe {
  const wrapped = (_event: IpcRendererEvent, payload: Payload): void => {
    listener(payload);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

/** Subscribe to an event that carries no payload. */
function subscribeBare(
  channel: IpcOnChannel,
  listener: () => void,
): Unsubscribe {
  const wrapped = (): void => listener();
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: QuotaWidgetApi = {
  auth: {
    login: (provider: ProviderType): Promise<AuthLoginResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.AUTH_LOGIN, provider),
    logout: (provider: ProviderType): Promise<AuthLogoutResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.AUTH_LOGOUT, provider),
    logoutEverywhere: (): Promise<AuthLogoutEverywhereResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.AUTH_LOGOUT_EVERYWHERE),
    checkSession: (provider: ProviderType): Promise<AuthSessionResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.AUTH_CHECK_SESSION, provider),
    listAccounts: (provider?: ProviderType): Promise<AuthAccountsResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.AUTH_LIST_ACCOUNTS, provider),
    setActiveAccount: (
      provider: ProviderType,
      accountId: string,
    ): Promise<AuthSetActiveAccountResult> =>
      ipcRenderer.invoke(
        IPC_INVOKE_CHANNELS.AUTH_SET_ACTIVE_ACCOUNT,
        provider,
        accountId,
      ),
  },

  usage: {
    getCurrent: (provider: ProviderType): Promise<UsageCurrentResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.USAGE_GET_CURRENT, provider),
  },

  poller: {
    start: (provider: ProviderType): Promise<PollerStateResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.POLLER_START, provider),
    stop: (): Promise<PollerStateResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.POLLER_STOP),
    setInterval: (seconds: number): Promise<PollerIntervalResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.POLLER_SET_INTERVAL, seconds),
  },

  settings: {
    get: (): Promise<WidgetSettings> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.SETTINGS_GET),
    update: (patch: Partial<WidgetSettings>): Promise<SettingsUpdateResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.SETTINGS_UPDATE, patch),
  },

  app: {
    getVersion: (): Promise<AppVersionResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.APP_GET_VERSION),
    quit: (): Promise<void> => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.APP_QUIT),
    minimize: (): Promise<void> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.APP_MINIMIZE),
    openExternal: (url: string): Promise<OpenExternalResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.APP_OPEN_EXTERNAL, url),
  },

  window: {
    resize: (width: number, height: number): Promise<WindowResizeResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.RESIZE_WINDOW, width, height),
    getPinned: (): Promise<WindowPinnedResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.WINDOW_GET_PINNED),
    setPinned: (pinned: boolean): Promise<WindowSetPinnedResult> =>
      ipcRenderer.invoke(IPC_INVOKE_CHANNELS.WINDOW_SET_PINNED, pinned),
    setIgnoreMouseEvents: (ignore: boolean): void => {
      ipcRenderer.send(IPC_SEND_CHANNELS.SET_IGNORE_MOUSE_EVENTS, ignore);
    },
  },

  events: {
    onUsageUpdated: (listener: (event: UsageUpdatedEvent) => void) =>
      subscribe(IPC_ON_CHANNELS.USAGE_UPDATED, listener),
    onThresholdCrossed: (listener: (event: ThresholdCrossedEvent) => void) =>
      subscribe(IPC_ON_CHANNELS.NOTIFICATION_THRESHOLD, listener),
    onAuthExpired: (listener: (event: AuthExpiredEvent) => void) =>
      subscribe(IPC_ON_CHANNELS.AUTH_EXPIRED, listener),
    onLoginSuccess: (listener: () => void) =>
      subscribeBare(IPC_ON_CHANNELS.AUTH_LOGIN_SUCCESS, listener),
    onLoginWindowOpened: (listener: (event: LoginWindowOpenedEvent) => void) =>
      subscribe(IPC_ON_CHANNELS.AUTH_LOGIN_WINDOW_OPENED, listener),
    onPollerError: (listener: (event: PollerErrorEvent) => void) =>
      subscribe(IPC_ON_CHANNELS.POLLER_ERROR, listener),
    onRefreshNow: (listener: () => void) =>
      subscribeBare(IPC_ON_CHANNELS.ACTION_REFRESH_NOW, listener),
    onOpenSettings: (listener: () => void) =>
      subscribeBare(IPC_ON_CHANNELS.ACTION_OPEN_SETTINGS, listener),
  },
};

contextBridge.exposeInMainWorld("quotaWidget", api);
