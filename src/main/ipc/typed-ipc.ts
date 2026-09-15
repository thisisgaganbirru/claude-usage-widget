/**
 * Registration layer for main-process IPC handlers.
 *
 * Two things happen here that `ipcMain.handle` does not do on its own:
 *
 * 1. Handlers are registered on a single window's `webContents.ipc` rather
 *    than globally, so a second BrowserWindow (a login window, a popup, a
 *    webview someone slips in) cannot reach them at all.
 * 2. Every call is checked against the sending frame: it must be the window's
 *    top-level frame and its origin must be one we serve the renderer from.
 *    An iframe, or a main frame that has navigated somewhere else, is
 *    rejected with an error the renderer can see and a warning we can read.
 *
 * Rejection throws rather than returning a value: a caller that should not be
 * calling gets a rejected promise, never a half-valid result.
 */
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from "electron";

import { createLogger } from "@main/logging/logger";
import { describeUrlForLog, originOf } from "@main/security/url-policy";
import type {
  IpcInvokeChannel,
  IpcOnChannel,
  IpcSendChannel,
} from "@shared/ipc-channels";

const log = createLogger("ipc");

export class IpcSenderRejectedError extends Error {
  constructor(channel: string) {
    super(`IPC call on ${channel} rejected: sender is not the widget frame.`);
    this.name = "IpcSenderRejectedError";
  }
}

export interface IpcRegistrar {
  /** Register a request/response handler scoped to this window. */
  handle<Result>(
    channel: IpcInvokeChannel,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Result,
  ): void;
  /** Register a fire-and-forget listener scoped to this window. */
  on(
    channel: IpcSendChannel,
    handler: (event: IpcMainEvent, ...args: unknown[]) => void,
  ): void;
  /** Send an event to this window, if it is still alive. */
  send(channel: IpcOnChannel, payload?: unknown): void;
  /** Drop every handler registered through this registrar. */
  dispose(): void;
}

/**
 * The origins the renderer is legitimately served from: a file:// bundle in a
 * packaged build, or the webpack dev server in development. Anything else
 * reaching a handler means the window navigated away, which is already a bug.
 */
export function rendererOrigins(entryUrl: string): readonly string[] {
  const origin = originOf(entryUrl);
  return origin ? [origin] : [];
}

/**
 * True when the event came from the window's own top-level frame, loaded from
 * an allowed origin. Reading `senderFrame` can throw if the frame is already
 * gone, which we treat as a rejection rather than a crash.
 */
export function isTrustedSender(
  event: IpcMainInvokeEvent | IpcMainEvent,
  allowedOrigins: readonly string[],
): boolean {
  let frame: Electron.WebFrameMain | null;
  try {
    frame = event.senderFrame;
  } catch {
    return false;
  }

  if (!frame) return false;
  // Only the top-level document may call: an embedded frame has a parent.
  if (frame.parent !== null) return false;

  const origin = originOf(frame.url);
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

function describeSender(event: IpcMainInvokeEvent | IpcMainEvent): string {
  try {
    return event.senderFrame
      ? describeUrlForLog(event.senderFrame.url)
      : "<no frame>";
  } catch {
    return "<detached frame>";
  }
}

/**
 * Bind a registrar to one window. Handlers live on that window's WebContents,
 * so they disappear with it and are unreachable from any other contents.
 */
export function createIpcRegistrar(
  window: BrowserWindow,
  allowedOrigins: readonly string[],
): IpcRegistrar {
  const contents = window.webContents;
  const invokeChannels: IpcInvokeChannel[] = [];
  const sendChannels: IpcSendChannel[] = [];

  return {
    handle(channel, handler) {
      invokeChannels.push(channel);
      contents.ipc.handle(channel, (event, ...args) => {
        if (!isTrustedSender(event, allowedOrigins)) {
          log.warn("invoke rejected", {
            channel,
            sender: describeSender(event),
          });
          throw new IpcSenderRejectedError(channel);
        }
        return handler(event, ...args);
      });
    },

    on(channel, handler) {
      sendChannels.push(channel);
      contents.ipc.on(channel, (event, ...args) => {
        if (!isTrustedSender(event, allowedOrigins)) {
          log.warn("message rejected", {
            channel,
            sender: describeSender(event),
          });
          return;
        }
        handler(event, ...args);
      });
    },

    send(channel, payload) {
      if (window.isDestroyed() || contents.isDestroyed()) return;
      if (payload === undefined) contents.send(channel);
      else contents.send(channel, payload);
    },

    dispose() {
      if (contents.isDestroyed()) return;
      for (const channel of invokeChannels) contents.ipc.removeHandler(channel);
      for (const channel of sendChannels)
        contents.ipc.removeAllListeners(channel);
      invokeChannels.length = 0;
      sendChannels.length = 0;
    },
  };
}
