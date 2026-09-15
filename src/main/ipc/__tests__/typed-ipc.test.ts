import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it } from "vitest";

import {
  IpcSenderRejectedError,
  isTrustedSender,
  rendererOrigins,
} from "../typed-ipc";

interface FakeFrame {
  url: string;
  parent: FakeFrame | null;
}

/** An event object with just the surface `isTrustedSender` reads. */
function eventWithFrame(frame: FakeFrame | null): IpcMainInvokeEvent {
  return { senderFrame: frame } as unknown as IpcMainInvokeEvent;
}

/** An event whose `senderFrame` getter throws, as it does once detached. */
function eventWithDetachedFrame(): IpcMainInvokeEvent {
  const event = {};
  Object.defineProperty(event, "senderFrame", {
    get() {
      throw new Error(
        "Render frame was disposed before WebFrameMain could be accessed",
      );
    },
  });
  return event as IpcMainInvokeEvent;
}

function mainFrame(url: string): FakeFrame {
  return { url, parent: null };
}

function childFrame(url: string, parent: FakeFrame): FakeFrame {
  return { url, parent };
}

describe("rendererOrigins", () => {
  it("collapses a file:// bundle path to the file marker", () => {
    expect(
      rendererOrigins("file:///C:/app/.webpack/renderer/index.html"),
    ).toEqual(["file://"]);
  });

  it("keeps the dev server origin including its port", () => {
    expect(rendererOrigins("http://localhost:3000/main_window")).toEqual([
      "http://localhost:3000",
    ]);
  });

  it("yields nothing for an unparseable entry", () => {
    expect(rendererOrigins("")).toEqual([]);
    expect(rendererOrigins("not a url")).toEqual([]);
  });
});

describe("isTrustedSender", () => {
  const allowed = ["file://", "http://localhost:3000"];

  it("accepts the top-level frame on an allowed origin", () => {
    const event = eventWithFrame(mainFrame("file:///app/index.html"));
    expect(isTrustedSender(event, allowed)).toBe(true);
  });

  it("accepts the dev server main frame", () => {
    const event = eventWithFrame(
      mainFrame("http://localhost:3000/main_window"),
    );
    expect(isTrustedSender(event, allowed)).toBe(true);
  });

  it("rejects an embedded frame even on an allowed origin", () => {
    const top = mainFrame("file:///app/index.html");
    const event = eventWithFrame(childFrame("file:///app/index.html", top));
    expect(isTrustedSender(event, allowed)).toBe(false);
  });

  it("rejects a main frame that navigated off origin", () => {
    const event = eventWithFrame(mainFrame("https://evil.example/page"));
    expect(isTrustedSender(event, allowed)).toBe(false);
  });

  it("rejects a lookalike origin", () => {
    const event = eventWithFrame(
      mainFrame("http://localhost:3001/main_window"),
    );
    expect(isTrustedSender(event, allowed)).toBe(false);
  });

  it("rejects an opaque origin", () => {
    const event = eventWithFrame(mainFrame("data:text/html,<script></script>"));
    expect(isTrustedSender(event, allowed)).toBe(false);
  });

  it("rejects a missing frame", () => {
    expect(isTrustedSender(eventWithFrame(null), allowed)).toBe(false);
  });

  it("rejects rather than throwing when the frame is gone", () => {
    expect(isTrustedSender(eventWithDetachedFrame(), allowed)).toBe(false);
  });

  it("rejects everything when the allowlist is empty", () => {
    const event = eventWithFrame(mainFrame("file:///app/index.html"));
    expect(isTrustedSender(event, [])).toBe(false);
  });
});

describe("IpcSenderRejectedError", () => {
  it("names the channel it refused", () => {
    const error = new IpcSenderRejectedError("settings:update");
    expect(error.name).toBe("IpcSenderRejectedError");
    expect(error.message).toContain("settings:update");
  });
});
