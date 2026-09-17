/**
 * Where "we already alerted about this" lives between runs.
 *
 * The old poller kept that set in memory beside the timer, so quitting the app
 * at 95% and reopening it a minute later replayed every alert from 50% up. It
 * is a tiny amount of data keyed by `provider:window`, so it goes in its own
 * store file rather than inside settings, where a user editing the config by
 * hand would trip over it.
 */
import Store from "electron-store";
import { createLogger } from "@main/logging/logger";
import type { ThresholdRecord, ThresholdStore } from "@main/scheduler";

const log = createLogger("thresholds");

interface ThresholdFile {
  records: Record<string, ThresholdRecord>;
}

function isRecordShape(value: unknown): value is ThresholdRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ThresholdRecord>;
  const resetsAtOk =
    candidate.resetsAt === null || typeof candidate.resetsAt === "string";
  const firedOk =
    Array.isArray(candidate.fired) &&
    candidate.fired.every((entry) => typeof entry === "number");
  return resetsAtOk && firedOk;
}

/** Drops anything that is not a well-formed record rather than throwing. */
function sanitize(raw: unknown): Record<string, ThresholdRecord> {
  if (typeof raw !== "object" || raw === null) return {};
  const clean: Record<string, ThresholdRecord> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isRecordShape(value)) clean[key] = value;
  }
  return clean;
}

export function createThresholdStore(): ThresholdStore {
  const store = new Store<ThresholdFile>({
    name: "threshold-state",
    defaults: { records: {} },
  });

  return {
    read(): Record<string, ThresholdRecord> {
      try {
        return sanitize(store.get("records"));
      } catch (error) {
        // Losing this state costs at most one duplicate notification, so it
        // must never be a reason for a poll to fail.
        log.warn("could not read threshold state", {
          error: error instanceof Error ? error.message : String(error),
        });
        return {};
      }
    },

    write(state: Record<string, ThresholdRecord>): void {
      try {
        store.set("records", state);
      } catch (error) {
        log.warn("could not persist threshold state", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/** An in-memory store, for tests and for a run where the disk store failed. */
export function createMemoryThresholdStore(): ThresholdStore {
  let state: Record<string, ThresholdRecord> = {};
  return {
    read: () => state,
    write: (next) => {
      state = next;
    },
  };
}
