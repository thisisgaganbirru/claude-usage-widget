/**
 * The Electron half of the scheduler's world.
 *
 * `Scheduler` takes this as an interface so its timing, backoff and threshold
 * logic can be tested under fake timers without an Electron runtime. Everything
 * that genuinely needs the app process lives here and nowhere else.
 */
import { net, powerMonitor } from "electron";
import type { SchedulerHost, SchedulerHostHandlers } from "@main/scheduler";

export function createElectronSchedulerHost(): SchedulerHost {
  return {
    now: () => Date.now(),
    isOnline: () => {
      try {
        return net.isOnline();
      } catch {
        // Better to poll and fail than to sit idle because we could not ask.
        return true;
      }
    },
    subscribe(handlers: SchedulerHostHandlers): () => void {
      const onSuspend = (): void => handlers.onSuspend();
      const onResume = (): void => handlers.onResume();

      // A locked screen is treated like a suspend: the machine is awake but
      // the user is not, and a laptop lid-close often reports only one of the
      // two. Unlock is the matching resume.
      powerMonitor.on("suspend", onSuspend);
      powerMonitor.on("resume", onResume);
      powerMonitor.on("lock-screen", onSuspend);
      powerMonitor.on("unlock-screen", onResume);

      // `onOnline` and `onOffline` stay unwired: Electron's main process has
      // no connectivity event, only the `net.isOnline()` poll above. A dropped
      // link therefore surfaces as a network error and its backoff, which is
      // the same outcome one step slower.

      return () => {
        powerMonitor.off("suspend", onSuspend);
        powerMonitor.off("resume", onResume);
        powerMonitor.off("lock-screen", onSuspend);
        powerMonitor.off("unlock-screen", onResume);
      };
    },
  };
}
