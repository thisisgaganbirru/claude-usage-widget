const { contextBridge, ipcRenderer } = require("electron");

console.log("[Preload] Starting preload script initialization...");

const listenerMap = new Map();

/**
 * Secure IPC bridge between renderer and main process
 * Only allow whitelisted channels
 */

const ALLOWED_CHANNELS_INVOKE = [
  // Auth channels
  "auth:login",
  "auth:logout",
  "auth:checkSession",
  // Usage channels
  "usage:getCurrent",
  // Poller channels
  "poller:start",
  "poller:stop",
  "poller:setInterval",
  // Settings channels
  "settings:get",
  "settings:update",
  // App channels
  "app:getVersion",
  "app:quit",
  "app:minimize",
  "app:openExternal",
  // Browser preference channels
  "browser:resetPreference",
  "browser:getPreference",
  // Window channels
  "resize-window",
  "move-window",
  "get-window-position",
  "window:getPinned",
  "window:setPinned",
  // Transparent hit-test passthrough
  "set-ignore-mouse-events",
  // Context menu
  "menu:showContextMenu",
];

const ALLOWED_CHANNELS_SEND = ["move-window-fire", "set-ignore-mouse-events"];

const ALLOWED_CHANNELS_ON = [
  // Usage updates
  "usage:updated",
  // Notifications
  "notification:threshold",
  // Auth events
  "auth:expired",
  "auth:login-success",
  "auth:login-window-opened",
  // Poller events
  "poller:error",
  // Action events
  "action:refreshNow",
  "action:openSettings",
  // Menu events
  "menu:sizeChange",
  "menu:logout",
];

function getWrappedListener(channel, listener) {
  let channelListeners = listenerMap.get(channel);

  if (!channelListeners) {
    channelListeners = new WeakMap();
    listenerMap.set(channel, channelListeners);
  }

  let wrappedListener = channelListeners.get(listener);
  if (!wrappedListener) {
    wrappedListener = (_event, ...args) => listener(...args);
    channelListeners.set(listener, wrappedListener);
  }

  return wrappedListener;
}

/**
 * Expose ipcRenderer methods to renderer via context bridge
 */
console.log("[Preload] About to expose electron object via context bridge");

contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: {
    /**
     * Invoke (request-response) pattern
     */
    invoke: (channel, ...args) => {
      if (!ALLOWED_CHANNELS_INVOKE.includes(channel)) {
        console.error(`[Preload] Blocked invoke on channel: ${channel}`);
        return Promise.reject(new Error(`Channel ${channel} is not allowed`));
      }
      return ipcRenderer.invoke(channel, ...args);
    },

    /**
     * On (listener) pattern
     */
    on: (channel, listener) => {
      if (!ALLOWED_CHANNELS_ON.includes(channel)) {
        console.error(`[Preload] Blocked listener on channel: ${channel}`);
        return;
      }
      ipcRenderer.on(channel, getWrappedListener(channel, listener));
    },

    /**
     * Once (single listener) pattern
     */
    once: (channel, listener) => {
      if (!ALLOWED_CHANNELS_ON.includes(channel)) {
        console.error(`[Preload] Blocked once listener on channel: ${channel}`);
        return;
      }
      ipcRenderer.once(channel, (event, ...args) => listener(...args));
    },

    /**
     * Remove listener
     */
    removeListener: (channel, listener) => {
      const wrappedListener = listenerMap.get(channel)?.get(listener);
      if (wrappedListener) {
        ipcRenderer.removeListener(channel, wrappedListener);
        listenerMap.get(channel).delete(listener);
      }
    },

    /**
     * Remove all listeners
     */
    removeAllListeners: (channel) => {
      ipcRenderer.removeAllListeners(channel);
      listenerMap.delete(channel);
    },

    /**
     * Send (fire-and-forget) pattern — for high-frequency events like drag
     */
    send: (channel, ...args) => {
      if (!ALLOWED_CHANNELS_SEND.includes(channel)) {
        console.error(`[Preload] Blocked send on channel: ${channel}`);
        return;
      }
      ipcRenderer.send(channel, ...args);
    },
  },
});

console.log("[Preload] Context bridge initialized");
console.log(
  "[Preload] window.electron object available:",
  typeof window.electron !== "undefined",
);
