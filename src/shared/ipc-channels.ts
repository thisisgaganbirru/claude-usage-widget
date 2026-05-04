export const IPC_INTERNAL_CHANNELS = {
  GET_CHANNELS: "ipc:getChannels",
} as const;

export const IPC_INVOKE_CHANNELS = {
  AUTH_LOGIN: "auth:login",
  AUTH_LOGOUT: "auth:logout",
  AUTH_CHECK_SESSION: "auth:checkSession",
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
  BROWSER_RESET_PREFERENCE: "browser:resetPreference",
  BROWSER_GET_PREFERENCE: "browser:getPreference",
  RESIZE_WINDOW: "resize-window",
  MOVE_WINDOW: "move-window",
  GET_WINDOW_POSITION: "get-window-position",
  WINDOW_GET_PINNED: "window:getPinned",
  WINDOW_SET_PINNED: "window:setPinned",
  SET_IGNORE_MOUSE_EVENTS: "set-ignore-mouse-events",
  MENU_SHOW_CONTEXT_MENU: "menu:showContextMenu",
} as const;

export const IPC_SEND_CHANNELS = {
  MOVE_WINDOW_FIRE: "move-window-fire",
  SET_IGNORE_MOUSE_EVENTS: "set-ignore-mouse-events",
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
  MENU_SIZE_CHANGE: "menu:sizeChange",
  MENU_LOGOUT: "menu:logout",
} as const;

export const IPC_CHANNELS = {
  invoke: Object.values(IPC_INVOKE_CHANNELS),
  send: Object.values(IPC_SEND_CHANNELS),
  on: Object.values(IPC_ON_CHANNELS),
} as const;
