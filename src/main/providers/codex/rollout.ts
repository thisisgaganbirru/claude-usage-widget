/**
 * Reads the last rate-limit snapshot Codex wrote to disk.
 *
 * Codex records one JSONL line per event under
 * `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<thread>.jsonl`, and a
 * `token_count` event carries the `rate_limits` snapshot the vendor returned.
 * Reading it means the Codex card works with no login, no network, and no
 * token of ours at all.
 *
 * Two properties this file is careful about:
 *
 * - It reads the *tail* of a rollout file, not the whole thing. A long session
 *   produces a large file and only its last snapshot matters.
 * - It skips anything it cannot parse. The rollout format is actively
 *   changing (compression, a session index, a SQLite store), so a line this
 *   version does not recognise has to be survivable, not fatal.
 */
import { promises as fs } from "fs";
import * as path from "path";
import { isPlainObject } from "../schema";

/** How much of a rollout file's end to read. Snapshot lines are under 1 KB. */
const TAIL_BYTES = 256 * 1024;

/** Day directories to look back through before giving up. */
const MAX_DAY_DIRS = 3;

/** Files to examine inside one day directory, newest first. */
const MAX_FILES_PER_DAY = 20;

export interface RolloutSnapshot {
  /** The raw `rate_limits` object, for the normalizer to validate. */
  rateLimits: unknown;
  /** The event's own timestamp: when the numbers were true. */
  recordedAt: string | null;
  /** Absolute path, for the log line. */
  file: string;
}

async function listDirs(parent: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(parent, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Up to `limit` day directories, newest first.
 *
 * The names are zero-padded numbers, so a plain reverse sort is date order.
 * Backtracking across months and years matters for the first days of a month,
 * when the newest month holds a single directory.
 */
export async function newestDayDirs(
  sessionsDir: string,
  limit = MAX_DAY_DIRS,
): Promise<string[]> {
  const found: string[] = [];

  for (const year of await listDirs(sessionsDir)) {
    const yearDir = path.join(sessionsDir, year);
    for (const month of await listDirs(yearDir)) {
      const monthDir = path.join(yearDir, month);
      for (const day of await listDirs(monthDir)) {
        found.push(path.join(monthDir, day));
        if (found.length >= limit) return found;
      }
    }
  }

  return found;
}

/** Rollout files in one day directory, newest modification first. */
async function rolloutFilesIn(dayDir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dayDir);
  } catch {
    return [];
  }

  const candidates = names.filter(
    (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"),
  );

  const stamped = await Promise.all(
    candidates.map(async (name) => {
      const file = path.join(dayDir, name);
      try {
        const stat = await fs.stat(file);
        return { file, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    }),
  );

  return stamped
    .filter(
      (entry): entry is { file: string; mtimeMs: number } => entry !== null,
    )
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_FILES_PER_DAY)
    .map((entry) => entry.file);
}

/** The tail of a file as whole lines, dropping a leading partial line. */
export async function readTailLines(
  file: string,
  tailBytes = TAIL_BYTES,
): Promise<string[]> {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, tailBytes);
    const start = size - length;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);

    const text = buffer.toString("utf8");
    const lines = text.split("\n");
    // Starting mid-file means the first line is a fragment of an earlier one.
    if (start > 0) lines.shift();
    return lines.filter((line) => line.trim().length > 0);
  } finally {
    await handle.close();
  }
}

/** The `rate_limits` of the last `token_count` event in one file. */
export async function snapshotFromFile(
  file: string,
): Promise<RolloutSnapshot | null> {
  let lines: string[];
  try {
    lines = await readTailLines(file);
  } catch {
    return null;
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    if (!isPlainObject(parsed)) continue;

    const payload = parsed.payload;
    if (!isPlainObject(payload)) continue;
    if (payload.type !== "token_count") continue;

    const rateLimits = payload.rate_limits;
    if (!isPlainObject(rateLimits)) continue;

    const timestamp = parsed.timestamp;
    return {
      rateLimits,
      recordedAt:
        typeof timestamp === "string" && !Number.isNaN(Date.parse(timestamp))
          ? new Date(timestamp).toISOString()
          : null,
      file,
    };
  }

  return null;
}

/**
 * The most recent snapshot on disk, or null when Codex is installed but has
 * not recorded a limit yet. Null is a legitimate answer, not a failure: a
 * fresh install has a sessions directory and nothing in it.
 */
export async function findLatestSnapshot(
  sessionsDir: string,
): Promise<RolloutSnapshot | null> {
  for (const dayDir of await newestDayDirs(sessionsDir)) {
    for (const file of await rolloutFilesIn(dayDir)) {
      const snapshot = await snapshotFromFile(file);
      if (snapshot !== null) return snapshot;
    }
  }
  return null;
}
