/**
 * The only place IPC channel names are spelled out.
 *
 * Only the preload and the main process import this module. The renderer talks
 * to `window.quotaWidget` (see src/shared/ipc-contract.ts) and never learns a
 * channel name, so it cannot invoke one directly even if it is compromised.
 * A lint guard in scripts/lint-guards.mjs enforces both halves of that.
 */
export const IPC_INVOKE_CHANNELS = {
  AUTH_LOGIN: "auth:login",
  AUTH_LOGOUT: "auth:logout",
  AUTH_LOGOUT_EVERYWHERE: "auth:logoutEverywhere",
  AUTH_CHECK_SESSION: "auth:checkSession",
  AUTH_LIST_ACCOUNTS: "auth:listAccounts",
  AUTH_SET_ACTIVE_ACCOUNT: "auth:setActiveAccount",
  USAGE_GET_CURRENT: "usage:getCurrent",
  POLLER_START: "poller:start",
  POLLER_STOP: "poller:stop",
  POLLER_SET_INTERVAL: "poller:setInterval",
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",
  APP_GET_VERSION: "app:getVersion",
  APP_QUIT: "app:quit",
  APP_MINIMIZE: "app:minimize",
  APP_OPEN_EXTERNAL: "app:openExternal",
  RESIZE_WINDOW: "window:resize",
  WINDOW_GET_PINNED: "window:getPinned",
  WINDOW_SET_PINNED: "window:setPinned",
} as const;

export const IPC_SEND_CHANNELS = {
  SET_IGNORE_MOUSE_EVENTS: "window:setIgnoreMouseEvents",
} as const;

export const IPC_ON_CHANNELS = {
  USAGE_UPDATED: "usage:updated",
  NOTIFICATION_THRESHOLD: "notification:threshold",
  AUTH_EXPIRED: "auth:expired",
  AUTH_LOGIN_SUCCESS: "auth:login-success",
  AUTH_LOGIN_WINDOW_OPENED: "auth:login-window-opened",
  POLLER_ERROR: "poller:error",
  ACTION_REFRESH_NOW: "action:refreshNow",
  ACTION_OPEN_SETTINGS: "action:openSettings",
} as const;

export type IpcInvokeChannel =
  (typeof IPC_INVOKE_CHANNELS)[keyof typeof IPC_INVOKE_CHANNELS];
export type IpcSendChannel =
  (typeof IPC_SEND_CHANNELS)[keyof typeof IPC_SEND_CHANNELS];
export type IpcOnChannel =
  (typeof IPC_ON_CHANNELS)[keyof typeof IPC_ON_CHANNELS];
