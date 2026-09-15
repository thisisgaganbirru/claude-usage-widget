/**
 * Structured logger for the main process.
 *
 * Every message and every field passes through the redaction layer before it
 * reaches any sink, so a raw credential cannot be logged even by mistake.
 *
 * Like `redact.ts`, this module never imports "electron": the caller supplies
 * the log file path, which keeps the whole thing unit-testable under node.
 */
import fs from "node:fs";
import path from "node:path";

import { redactFields, redactText } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  time: string;
  level: LogLevel;
  scope: string;
  message: string;
  fields?: Record<string, unknown>;
}

export interface LogSink {
  write(record: LogRecord): void;
}

export interface Logger {
  readonly scope: string;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(subScope: string): Logger;
}

export interface LoggingOptions {
  level?: LogLevel;
  sinks?: LogSink[];
}

export interface FileSinkOptions {
  filePath: string;
  maxBytes?: number;
  keep?: number;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export const DEFAULT_LOG_LEVEL: LogLevel = "info";
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_KEEP = 2;

/**
 * Console methods captured at module load, before `attachConsoleBridge` can
 * patch them. The console sink always writes through these, so bridging
 * console.* into the logger can never recurse.
 */
const nativeConsole = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  log: console.log.bind(console),
};

/** A sink that prints one structured line per record to the real console. */
export function createConsoleSink(): LogSink {
  return {
    write(record: LogRecord): void {
      const prefix = `[${record.time}] ${record.level.toUpperCase()} ${record.scope}:`;
      const write =
        record.level === "error"
          ? nativeConsole.error
          : record.level === "warn"
            ? nativeConsole.warn
            : record.level === "debug"
              ? nativeConsole.debug
              : nativeConsole.info;
      if (record.fields) {
        write(prefix, record.message, record.fields);
      } else {
        write(prefix, record.message);
      }
    },
  };
}

let currentLevel: LogLevel = DEFAULT_LOG_LEVEL;
let currentSinks: LogSink[] = [createConsoleSink()];

/** Install a log level and/or a set of sinks. Sinks are fully injectable. */
export function configureLogging(options: LoggingOptions): void {
  if (options.level) currentLevel = options.level;
  if (options.sinks) currentSinks = [...options.sinks];
}

/** Restore the default level and the default console sink. */
export function resetLogging(): void {
  currentLevel = DEFAULT_LOG_LEVEL;
  currentSinks = [createConsoleSink()];
}

/** The level currently in force. */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

function emit(
  level: LogLevel,
  scope: string,
  message: string,
  fields?: Record<string, unknown>,
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;

  const record: LogRecord = {
    time: new Date().toISOString(),
    level,
    scope,
    message: redactText(message),
  };

  if (fields) {
    const redacted = redactFields(fields);
    if (Object.keys(redacted).length > 0) record.fields = redacted;
  }

  for (const sink of currentSinks) {
    try {
      sink.write(record);
    } catch {
      // A broken sink must never take the app down with it.
    }
  }
}

/** Create a logger bound to a scope, e.g. `createLogger("poller")`. */
export function createLogger(scope: string): Logger {
  return {
    scope,
    debug: (message, fields) => emit("debug", scope, message, fields),
    info: (message, fields) => emit("info", scope, message, fields),
    warn: (message, fields) => emit("warn", scope, message, fields),
    error: (message, fields) => emit("error", scope, message, fields),
    child: (subScope) =>
      createLogger(scope ? `${scope}:${subScope}` : subScope),
  };
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/** Shift `file` -> `file.1` -> `file.2`, dropping anything past `keep`. */
function rotate(filePath: string, keep: number): void {
  if (keep <= 0) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Best effort only.
    }
    return;
  }

  try {
    fs.rmSync(`${filePath}.${keep}`, { force: true });
  } catch {
    // Best effort only.
  }

  for (let index = keep - 1; index >= 1; index -= 1) {
    try {
      if (fs.existsSync(`${filePath}.${index}`)) {
        fs.renameSync(`${filePath}.${index}`, `${filePath}.${index + 1}`);
      }
    } catch {
      // Best effort only.
    }
  }

  try {
    fs.renameSync(filePath, `${filePath}.1`);
  } catch {
    // Best effort only.
  }
}

/**
 * A sink that appends one JSON object per line and rotates the file once it
 * would grow past `maxBytes`. It never throws: a failed write is swallowed so
 * that logging cannot crash the app.
 */
export function createFileSink(options: FileSinkOptions): LogSink {
  const filePath = options.filePath;
  const maxBytes =
    typeof options.maxBytes === "number" && options.maxBytes > 0
      ? options.maxBytes
      : DEFAULT_MAX_BYTES;
  const keep =
    typeof options.keep === "number" && options.keep >= 0
      ? options.keep
      : DEFAULT_KEEP;
  let directoryReady = false;

  return {
    write(record: LogRecord): void {
      try {
        if (!directoryReady) {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          directoryReady = true;
        }
        const line = `${JSON.stringify(record)}\n`;
        const size = fileSize(filePath);
        if (size > 0 && size + Buffer.byteLength(line) > maxBytes) {
          rotate(filePath, keep);
        }
        fs.appendFileSync(filePath, line, "utf8");
      } catch {
        // Logging is best effort; never surface I/O failures to the caller.
      }
    },
  };
}

function formatConsoleArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return "[unserializable]";
  }
}

function formatConsoleArgs(args: unknown[]): string {
  return args.map(formatConsoleArg).join(" ");
}

/**
 * Escape hatch for call sites that still use `console.*`: route console.log,
 * console.warn and console.error through `logger` (and therefore through the
 * redaction layer). Returns a function that restores the original methods.
 */
export function attachConsoleBridge(logger: Logger): () => void {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  console.log = (...args: unknown[]): void => {
    logger.info(formatConsoleArgs(args));
  };
  console.warn = (...args: unknown[]): void => {
    logger.warn(formatConsoleArgs(args));
  };
  console.error = (...args: unknown[]): void => {
    logger.error(formatConsoleArgs(args));
  };

  return () => {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  };
}
