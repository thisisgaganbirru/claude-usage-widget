/**
 * Time and percentage formatting for the UI.
 *
 * Every function takes an ISO string, because that is what crosses IPC. A
 * string the main process could not parse arrives as null, and these render
 * that honestly instead of substituting "now" or a made-up interval.
 */

/** "2 hr 15 min", "45 min", "now", or null when there is no reset time. */
export function formatResetIn(
  isoDate: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!isoDate) return null;
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return null;

  const diff = parsed - now;
  if (diff <= 0) return "now";

  const totalMinutes = Math.floor(diff / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  if (days >= 1) {
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    return hours > 0 ? `${days}d ${hours} hr` : `${days}d`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours} hr ${minutes} min`;
  if (hours > 0) return `${hours} hr`;
  return `${minutes} min`;
}

/** "just now", "3 min ago", "2 hr ago" for a past timestamp. */
export function formatAgo(
  isoDate: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!isoDate) return null;
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return null;

  const diff = now - parsed;
  if (diff < 60_000) return "just now";

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

/** A ticking "3d 04:12:07", or null when there is no reset time to count to. */
export function formatCountdown(
  isoDate: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!isoDate) return null;
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return null;

  const diff = Math.max(0, parsed - now);
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${days}d ${pad(Math.floor((totalSeconds % 86_400) / 3600))}:${pad(
    Math.floor((totalSeconds % 3600) / 60),
  )}:${pad(totalSeconds % 60)}`;
}

/** "Tue, Mar 4, 09:00" in the user's own locale settings. */
export function formatResetDate(
  isoDate: string | null | undefined,
): string | null {
  if (!isoDate) return null;
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}
