import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findLatestSnapshot,
  newestDayDirs,
  readTailLines,
  snapshotFromFile,
} from "../rollout";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-rollout-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

function tokenCountLine(timestamp: string, usedPercent: number): string {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        primary: { used_percent: usedPercent, window_minutes: 300 },
      },
    },
  });
}

/** One day directory holding one rollout file, with the given lines. */
async function writeRollout(
  sessionsDir: string,
  day: readonly [string, string, string],
  name: string,
  lines: readonly string[],
): Promise<string> {
  const dir = path.join(sessionsDir, ...day);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fs.writeFile(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

describe("readTailLines", () => {
  it("returns every whole line of a file shorter than the tail", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "small.jsonl");
    await fs.writeFile(file, "one\ntwo\nthree\n", "utf8");

    expect(await readTailLines(file)).toEqual(["one", "two", "three"]);
  });

  it("drops the partial line a mid-file start lands in", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "big.jsonl");
    await fs.writeFile(file, "aaaa\nbbbb\ncccc\ndddd\n", "utf8");

    // 12 bytes is mid-way through "bbbb", so that line is a fragment.
    expect(await readTailLines(file, 12)).toEqual(["cccc", "dddd"]);
  });

  it("returns nothing for an empty file", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "empty.jsonl");
    await fs.writeFile(file, "", "utf8");

    expect(await readTailLines(file)).toEqual([]);
  });
});

describe("snapshotFromFile", () => {
  it("takes the last token_count event, not the first", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "rollout-a.jsonl");
    await fs.writeFile(
      file,
      [
        tokenCountLine("2026-03-10T01:00:00Z", 10),
        tokenCountLine("2026-03-10T02:00:00Z", 55),
      ].join("\n"),
      "utf8",
    );

    const snapshot = await snapshotFromFile(file);

    expect(snapshot?.recordedAt).toBe("2026-03-10T02:00:00.000Z");
    expect(snapshot?.rateLimits).toEqual({
      primary: { used_percent: 55, window_minutes: 300 },
    });
  });

  it("skips lines it cannot parse and events of other types", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "rollout-b.jsonl");
    await fs.writeFile(
      file,
      [
        tokenCountLine("2026-03-10T01:00:00Z", 10),
        JSON.stringify({ payload: { type: "agent_message" } }),
        JSON.stringify({ payload: { type: "token_count" } }),
        "{ truncated",
      ].join("\n"),
      "utf8",
    );

    const snapshot = await snapshotFromFile(file);

    expect(snapshot?.recordedAt).toBe("2026-03-10T01:00:00.000Z");
  });

  it("returns null for a file with no snapshot in it", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "rollout-c.jsonl");
    await fs.writeFile(file, JSON.stringify({ payload: {} }), "utf8");

    expect(await snapshotFromFile(file)).toBeNull();
  });

  it("returns null rather than throwing for a file that is not there", async () => {
    const dir = await tempDir();
    expect(await snapshotFromFile(path.join(dir, "gone.jsonl"))).toBeNull();
  });
});

describe("newestDayDirs", () => {
  it("lists day directories newest first, across month and year", async () => {
    const sessions = await tempDir();
    for (const day of [
      ["2025", "12", "31"],
      ["2026", "01", "01"],
      ["2026", "03", "09"],
      ["2026", "03", "10"],
    ] as const) {
      await fs.mkdir(path.join(sessions, ...day), { recursive: true });
    }

    const dirs = await newestDayDirs(sessions, 4);

    expect(dirs.map((dir) => path.relative(sessions, dir))).toEqual([
      path.join("2026", "03", "10"),
      path.join("2026", "03", "09"),
      path.join("2026", "01", "01"),
      path.join("2025", "12", "31"),
    ]);
  });

  it("stops at the limit", async () => {
    const sessions = await tempDir();
    for (const day of ["08", "09", "10"]) {
      await fs.mkdir(path.join(sessions, "2026", "03", day), {
        recursive: true,
      });
    }

    expect(await newestDayDirs(sessions, 2)).toHaveLength(2);
  });

  it("returns nothing for a sessions directory that does not exist", async () => {
    const dir = await tempDir();
    expect(await newestDayDirs(path.join(dir, "sessions"))).toEqual([]);
  });
});

describe("findLatestSnapshot", () => {
  it("reads the newest day before an older one", async () => {
    const sessions = await tempDir();
    await writeRollout(sessions, ["2026", "03", "09"], "rollout-old.jsonl", [
      tokenCountLine("2026-03-09T01:00:00Z", 10),
    ]);
    await writeRollout(sessions, ["2026", "03", "10"], "rollout-new.jsonl", [
      tokenCountLine("2026-03-10T01:00:00Z", 80),
    ]);

    const snapshot = await findLatestSnapshot(sessions);

    expect(snapshot?.recordedAt).toBe("2026-03-10T01:00:00.000Z");
  });

  it("falls back to an earlier day when the newest has no snapshot", async () => {
    const sessions = await tempDir();
    await writeRollout(sessions, ["2026", "03", "09"], "rollout-old.jsonl", [
      tokenCountLine("2026-03-09T01:00:00Z", 10),
    ]);
    await writeRollout(sessions, ["2026", "03", "10"], "rollout-new.jsonl", [
      JSON.stringify({ payload: { type: "agent_message" } }),
    ]);

    const snapshot = await findLatestSnapshot(sessions);

    expect(snapshot?.recordedAt).toBe("2026-03-09T01:00:00.000Z");
  });

  it("ignores files that are not rollout logs", async () => {
    const sessions = await tempDir();
    const dir = path.join(sessions, "2026", "03", "10");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "notes.txt"),
      tokenCountLine("2026-03-10T01:00:00Z", 80),
      "utf8",
    );

    expect(await findLatestSnapshot(sessions)).toBeNull();
  });

  it("returns null when Codex has recorded nothing yet", async () => {
    const sessions = await tempDir();
    expect(await findLatestSnapshot(sessions)).toBeNull();
  });
});
