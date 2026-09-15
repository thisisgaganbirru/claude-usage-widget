/**
 * URL decisions used by the Electron security policy.
 *
 * This module deliberately imports nothing from `electron` so the rules can be
 * exercised in a plain Node test process. `policy.ts` is the only place that
 * wires these decisions onto real WebContents and Session objects.
 *
 * Every decision is made from a parsed `URL`, never from string prefixes.
 * A prefix test such as `url.startsWith("https://claude.ai/")` is trivially
 * defeated by `https://claude.ai/@attacker.example/`, and a bare `includes`
 * test is worse still.
 */

/** Stand-in origin for `file:` URLs, whose real origin is opaque ("null"). */
export const FILE_ORIGIN = "file://";

/** Stand-in origin for Chromium's own DevTools pages. */
export const DEVTOOLS_ORIGIN = "devtools://";

export function parseUrl(raw: string): URL | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Comparable origin for an arbitrary URL, or null when the URL cannot be
 * parsed. `file:` and `devtools:` URLs have opaque origins, so they collapse
 * onto their own markers instead of the string "null" that every opaque
 * origin shares.
 */
export function originOf(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url) return null;
  if (url.protocol === "file:") return FILE_ORIGIN;
  if (url.protocol === "devtools:") return DEVTOOLS_ORIGIN;
  if (url.origin === "null") return null;
  return url.origin;
}

/** True when `raw` may be loaded into a WebContents bound to these origins. */
export function isNavigationAllowed(
  raw: string,
  allowedOrigins: readonly string[],
): boolean {
  const origin = originOf(raw);
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

export type ExternalUrlRejection =
  | "malformed"
  | "insecure-scheme"
  | "embedded-credentials"
  | "origin-not-allowed";

export type ExternalUrlDecision =
  | { allowed: true; url: string }
  | { allowed: false; reason: ExternalUrlRejection };

/**
 * Decide whether a URL may be handed to the operating system browser.
 *
 * `shell.openExternal` launches whatever the OS associates with the scheme, so
 * anything but https is refused outright: `file:`, `smb:` and the various
 * application schemes are all remote code execution with extra steps.
 */
export function classifyExternalUrl(
  raw: string,
  allowedOrigins: readonly string[],
): ExternalUrlDecision {
  const url = parseUrl(raw);
  if (!url) return { allowed: false, reason: "malformed" };
  if (url.protocol !== "https:") {
    return { allowed: false, reason: "insecure-scheme" };
  }
  if (url.username !== "" || url.password !== "") {
    return { allowed: false, reason: "embedded-credentials" };
  }
  if (!allowedOrigins.includes(url.origin)) {
    return { allowed: false, reason: "origin-not-allowed" };
  }
  return { allowed: true, url: url.toString() };
}

/**
 * Shorten a URL for logs: origin and path only, with query and fragment
 * dropped because OAuth flows carry codes and tokens there.
 */
export function describeUrlForLog(raw: string): string {
  const url = parseUrl(raw);
  if (!url) return "<unparseable url>";
  if (url.protocol === "file:") return `${FILE_ORIGIN}${url.pathname}`;
  return `${url.origin}${url.pathname}`;
}
