/**
 * A clock that re-renders on a fixed interval.
 *
 * Countdowns used to each own a `setInterval` that wrote a preformatted
 * string into state, which meant the formatting logic had to live next to the
 * timer. Here the timer only supplies "now" and the formatters stay pure.
 */
import { useEffect, useState } from "react";

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
