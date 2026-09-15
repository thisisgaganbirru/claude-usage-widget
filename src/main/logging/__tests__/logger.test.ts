import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type LogRecord,
  type LogSink,
  attachConsoleBridge,
  configureLogging,
  createFileSink,
  createLogger,
  getLogLevel,
  resetLogging,
} from "../logger";
import { REDACTED } from "../redact";

const FAKE_KEY = "sk-ant-api03-AbCdEfGh1234567890IjKlMnOpQrStUvWxYz";

function memorySink(): { sink: LogSink; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    sink: {
      write(record: LogRecord): void {
        records.push(record);
      },
    },
    records,
  };
}

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cuw-log-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  resetLogging();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("createLogger", () => {
  it("emits a structured record with time, level, scope and message", () => {
    const { sink, records } = memorySink();
    configureLogging({ level: "info", sinks: [sink] });

    createLogger("core").info("hello");

    expect(records).toHaveLength(1);
    expect(records[0].level).toBe("info");
    expect(records[0].scope).toBe("core");
    expect(records[0].message).toBe("hello");
    expect(Date.parse(records[0].time)).not.toBeNaN();
  });

  it("nests child scopes", () => {
    const { sink, records } = memorySink();
    configureLogging({ level: "info", sinks: [sink] });

    const child = createLogger("core").child("fetch");
    child.info("ping");

    expect(child.scope).toBe("core:fetch");
    expect(records[0].scope).toBe("core:fetch");
  });

  it("omits the fields key when no fields are given", () => {
    const { sink, records } = memorySink();
    configureLogging({ level: "info", sinks: [sink] });

    createLogger("core").warn("careful");

    expect(records[0].fields).toBeUndefined();
  });
});

describe("level filtering", () => {
  it("suppresses debug unless the level is debug", () => {
    const { sink, records } = memorySink();
    configureLogging({ level: "info", sinks: [sink] });

    const log = createLogger("core");
    log.debug("quiet");
    expect(records).toHaveLength(0);

    log.info("loud");
    expect(records).toHaveLength(1);
  });

  it("emits debug when the level is debug", () => {
    const { sink, records } = memorySink();
    configureLogging({ level: "debug", sinks: [sink] });

    createLogger("core").debug("verbose");

    expect(records).toHaveLength(1);
    expect(getLogLevel()).toBe("debug");
  });

  it("suppresses everything below the configured level", () => {
    const { sink, records } = memorySink();
    configureLogging({ level: "error", sinks: [sink] });

    const log = createLogger("core");
    log.info("nope");
    log.warn("nope");
    log.error("yes");

    expect(records.map((record) => record.level)).toEqual(["error"]);
  });

  it("resets to the default level and console sink", () => {
    configureLogging({ level: "debug" });
    resetLogging();
    expect(getLogLevel()).toBe("info");
  });
});

describe("redaction at the sink boundary", () => {
  it("redacts the message before any sink sees it", () => {
    const { sink, records } = memorySink();
    configureLogging({ level: "info", sinks: [sink] });

    createLogger("core").error(`request failed with ${FAKE_KEY}`);

    expect(records[0].message).toBe(`request failed with ${REDACTED}`);
    expect(records[0].message).not.toContain("sk-ant-");
  });

  it("redacts fields by value and by key name", () => {
    const { sink, records } = memorySink();
    configureLogging({ level: "info", sinks: [sink] });

    createLogger("core").info("fetched", {
      sessionKey: "looks-harmless",
      url: "https://api.example.com/v1/usage?apiKey=abc123",
      note: `saw ${FAKE_KEY}`,
      status: 200,
    });

    expect(records[0].fields).toEqual({
      sessionKey: REDACTED,
      url: "https://api.example.com/v1/usage",
      note: `saw ${REDACTED}`,
      status: 200,
    });
  });

  it("gives every sink the same redacted record", () => {
    const first = memorySink();
    const second = memorySink();
    configureLogging({ level: "info", sinks: [first.sink, second.sink] });

    createLogger("core").info(`key ${FAKE_KEY}`);

    expect(first.records[0]).toBe(second.records[0]);
    expect(second.records[0].message).not.toContain("sk-ant-");
  });
});

describe("sink failures", () => {
  it("does not propagate a throwing sink and still feeds later sinks", () => {
    const throwing: LogSink = {
      write(): void {
        throw new Error("sink exploded");
      },
    };
    const { sink, records } = memorySink();
    configureLogging({ level: "info", sinks: [throwing, sink] });

    expect(() => createLogger("core").info("still fine")).not.toThrow();
    expect(records).toHaveLength(1);
  });
});

describe("createFileSink", () => {
  it("appends one JSON object per line", () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "nested", "widget.log");
    configureLogging({
      level: "info",
      sinks: [createFileSink({ filePath })],
    });

    const log = createLogger("core");
    log.info("first", { status: 200 });
    log.error(`second ${FAKE_KEY}`);

    const lines = fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0);

    expect(lines).toHaveLength(2);
    const parsed = lines.map((line) => JSON.parse(line) as LogRecord);
    expect(parsed[0].message).toBe("first");
    expect(parsed[0].fields).toEqual({ status: 200 });
    expect(parsed[1].message).toBe(`second ${REDACTED}`);
  });

  it("rotates the file, keeping the configured number of copies", () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "widget.log");
    configureLogging({
      level: "info",
      sinks: [createFileSink({ filePath, maxBytes: 400, keep: 2 })],
    });

    const log = createLogger("core");
    for (let index = 0; index < 40; index += 1) {
      log.info(`message number ${index} with some padding to grow the file`);
    }

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(`${filePath}.1`)).toBe(true);
    expect(fs.existsSync(`${filePath}.2`)).toBe(true);
    expect(fs.existsSync(`${filePath}.3`)).toBe(false);
    expect(fs.statSync(filePath).size).toBeLessThanOrEqual(400);
  });

  it("never throws when the path cannot be written", () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "widget.log");
    fs.mkdirSync(filePath);

    const sink = createFileSink({ filePath });
    expect(() =>
      sink.write({
        time: new Date().toISOString(),
        level: "info",
        scope: "core",
        message: "unwritable",
      }),
    ).not.toThrow();
  });
});

describe("attachConsoleBridge", () => {
  it("routes console.* through the logger and restores the originals", () => {
    const { sink, records } = memorySink();
    configureLogging({ level: "info", sinks: [sink] });

    const original = console.log;
    const restore = attachConsoleBridge(createLogger("bridge"));
    try {
      console.log("leaking", FAKE_KEY);
      console.warn("careful");
      console.error(new Error("boom"));
    } finally {
      restore();
    }

    expect(console.log).toBe(original);
    expect(records.map((record) => record.level)).toEqual([
      "info",
      "warn",
      "error",
    ]);
    expect(records[0].scope).toBe("bridge");
    expect(records[0].message).toBe(`leaking ${REDACTED}`);
    expect(records[2].message).toBe("Error: boom");

    const countAfterRestore = records.length;
    console.log("not captured");
    expect(records).toHaveLength(countAfterRestore);
  });
});
