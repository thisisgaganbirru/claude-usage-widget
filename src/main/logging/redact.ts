/**
 * Redaction layer for the structured logger.
 *
 * This module is deliberately pure: it must never import from "electron" so it
 * stays unit-testable in a plain node environment and reusable from any
 * process. Everything that reaches a log sink is funnelled through here first,
 * which is what makes logging a raw credential structurally impossible.
 */

/** The one and only replacement marker. */
export const REDACTED = "[redacted]";

/** Marker emitted when the walker refuses to descend any further. */
export const TRUNCATED = "[truncated]";

/** Marker emitted when the walker re-enters an object it is already inside. */
export const CIRCULAR = "[circular]";

/** Maximum object/array nesting depth that `redactValue` will walk. */
export const MAX_DEPTH = 6;

/** Maximum number of array entries that `redactValue` will keep. */
export const MAX_ARRAY_LENGTH = 50;

/**
 * Field names whose value is replaced wholesale, regardless of how innocuous
 * the value looks. A field called `apiKey` is never worth logging.
 */
export const SENSITIVE_KEY_PATTERN =
  /token|cookie|secret|password|key|authorization|credential|session/i;

/* -------------------------------------------------------------------------
 * Credential shapes
 *
 * One regex per shape, applied in the order declared below. Specific shapes
 * run before generic ones so that a token embedded in a URL path is masked
 * before the URL itself is reduced to origin + pathname.
 * ---------------------------------------------------------------------- */

/** Anthropic API keys and session ids: `sk-ant-api03-…`, `sk-ant-sid01-…`. */
const ANTHROPIC_KEY_PATTERN = /\bsk-ant-[A-Za-z0-9_-]{20,}/g;

/** OpenAI-style keys: `sk-proj-…` and the older bare `sk-…` form. */
const OPENAI_KEY_PATTERN = /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g;

/** GitHub tokens: `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` + 20 or more chars. */
const GITHUB_TOKEN_PATTERN = /\bgh[pousr]_[A-Za-z0-9]{20,}/g;

/** Google OAuth access tokens: `ya29.<chars>`. */
const GOOGLE_ACCESS_TOKEN_PATTERN = /\bya29\.[A-Za-z0-9._-]{10,}/g;

/** Google OAuth refresh tokens: `1//<chars>` (never inside a URL path). */
const GOOGLE_REFRESH_TOKEN_PATTERN = /(?<![\w/])1\/\/[A-Za-z0-9_-]{10,}/g;

/** JSON Web Tokens: three base64url segments, the first starting `eyJ`. */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

/** `Authorization: Bearer <token>` — the name is kept, the token is not. */
const BEARER_PATTERN = /\bBearer\s+\S+/gi;

/** Whole `Cookie:` / `Set-Cookie:` header lines. */
const COOKIE_HEADER_PATTERN = /^([ \t]*(?:set-)?cookie[ \t]*:[ \t]*)(.+)$/gim;

/**
 * Session cookies we know this app (and the providers it talks to) issue.
 * Longer names come first so the alternation cannot match a shorter suffix.
 */
const KNOWN_COOKIE_PATTERN =
  /\b(sessionKeyV2|sessionKey|CH_SESSION|__Secure-next-auth\.session-token|__Secure-authjs\.session-token|next-auth\.session-token|authjs\.session-token|WorkosCursorSessionToken)=[^;,\s]+/gi;

/**
 * Any remaining `name=value` pair whose name hints at a credential. The name
 * is preserved so the log still says *what* was dropped.
 */
const GENERIC_PAIR_PATTERN =
  /(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]*(?:token|session|auth|key|secret|password|credential)[A-Za-z0-9_.-]*)=[^;,&\s]+/gi;

/** The same idea for JSON-ish text: `"apiKey": "…"`. */
const JSON_PAIR_PATTERN =
  /("(?:[A-Za-z0-9_.-]*(?:token|session|auth|key|secret|password|credential)[A-Za-z0-9_.-]*)"\s*:\s*)"[^"]*"/gi;

/** Any http(s) URL; the replacer reduces it to origin + pathname. */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`\\]+/gi;

/** Trailing sentence punctuation that should not be treated as part of a URL. */
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!?]+$/;

/** Cookie attributes are metadata, not secrets, so they survive intact. */
const COOKIE_ATTRIBUTES = new Set([
  "path",
  "domain",
  "expires",
  "max-age",
  "samesite",
  "secure",
  "httponly",
  "partitioned",
  "priority",
  "version",
  "comment",
]);

type Replacer = (match: string, ...groups: string[]) => string;

interface RedactionRule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replace: Replacer;
}

/** Replace every non-attribute cookie value in a `a=1; b=2` list. */
function redactCookieList(list: string): string {
  return list
    .split(";")
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator === -1) return part;
      const name = part.slice(0, separator);
      if (COOKIE_ATTRIBUTES.has(name.trim().toLowerCase())) return part;
      return `${name}=${REDACTED}`;
    })
    .join(";");
}

/**
 * Reduce a URL to origin + pathname. A query string is where tokens leak, so
 * the query and fragment are dropped wholesale — and `origin` also discards
 * any `user:password@` userinfo. Parsing is a real URL parse, not a regex.
 */
function normalizeUrl(match: string): string {
  const trailing = TRAILING_PUNCTUATION_PATTERN.exec(match)?.[0] ?? "";
  const candidate = trailing ? match.slice(0, -trailing.length) : match;
  try {
    const url = new URL(candidate);
    return `${url.origin}${url.pathname}${trailing}`;
  } catch {
    return `${candidate.split(/[?#]/)[0]}${trailing}`;
  }
}

const RULES: readonly RedactionRule[] = [
  {
    name: "anthropic-key",
    pattern: ANTHROPIC_KEY_PATTERN,
    replace: () => REDACTED,
  },
  {
    name: "openai-key",
    pattern: OPENAI_KEY_PATTERN,
    replace: () => REDACTED,
  },
  {
    name: "github-token",
    pattern: GITHUB_TOKEN_PATTERN,
    replace: () => REDACTED,
  },
  {
    name: "google-access-token",
    pattern: GOOGLE_ACCESS_TOKEN_PATTERN,
    replace: () => REDACTED,
  },
  {
    name: "google-refresh-token",
    pattern: GOOGLE_REFRESH_TOKEN_PATTERN,
    replace: () => REDACTED,
  },
  { name: "jwt", pattern: JWT_PATTERN, replace: () => REDACTED },
  {
    name: "bearer",
    pattern: BEARER_PATTERN,
    replace: () => `Bearer ${REDACTED}`,
  },
  {
    name: "cookie-header",
    pattern: COOKIE_HEADER_PATTERN,
    replace: (_match, prefix, list) => `${prefix}${redactCookieList(list)}`,
  },
  {
    name: "known-session-cookie",
    pattern: KNOWN_COOKIE_PATTERN,
    replace: (_match, name) => `${name}=${REDACTED}`,
  },
  { name: "url", pattern: URL_PATTERN, replace: normalizeUrl },
  {
    name: "generic-credential-pair",
    pattern: GENERIC_PAIR_PATTERN,
    replace: (_match, name) => `${name}=${REDACTED}`,
  },
  {
    name: "json-credential-pair",
    pattern: JSON_PAIR_PATTERN,
    replace: (_match, prefix) => `${prefix}"${REDACTED}"`,
  },
];

/** The rule names, in application order. Exported for documentation/tests. */
export const REDACTION_RULE_NAMES: readonly string[] = RULES.map(
  (rule) => rule.name,
);

/**
 * Mask every known credential shape in a string.
 *
 * Idempotent by construction: every replacement produces text that either no
 * longer matches, or matches and maps to itself, so
 * `redactText(redactText(x)) === redactText(x)`.
 */
export function redactText(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;
  let output = input;
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    output = output.replace(rule.pattern, rule.replace);
  }
  return output;
}

/** The shape an `Error` is flattened into. */
export interface RedactedError {
  name: string;
  message: string;
  stack?: string;
}

/** Flatten an `Error` into a plain, redacted object. */
export function redactError(error: Error): RedactedError {
  const redacted: RedactedError = {
    name: error.name,
    message: redactText(error.message),
  };
  if (typeof error.stack === "string") {
    redacted.stack = redactText(error.stack);
  }
  return redacted;
}

function walkValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null) return null;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "undefined") return undefined;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "[function]";

  if (value instanceof Error) return redactError(value);
  if (value instanceof Date) return value.toISOString();

  if (depth >= MAX_DEPTH) return TRUNCATED;

  const container: object = value;
  if (seen.has(container)) return CIRCULAR;
  seen.add(container);

  try {
    if (Array.isArray(value)) {
      const items: unknown[] = value;
      const kept: unknown[] = items
        .slice(0, MAX_ARRAY_LENGTH)
        .map((item) => walkValue(item, depth + 1, seen));
      if (items.length > MAX_ARRAY_LENGTH) {
        kept.push(`[+${items.length - MAX_ARRAY_LENGTH} more]`);
      }
      return kept;
    }

    if (value instanceof Set) {
      return walkValue(Array.from(value), depth, seen);
    }

    if (value instanceof Map) {
      const fromMap: Record<string, unknown> = {};
      for (const [key, entry] of value.entries()) {
        const name = String(key);
        fromMap[name] = SENSITIVE_KEY_PATTERN.test(name)
          ? REDACTED
          : walkValue(entry, depth + 1, seen);
      }
      return fromMap;
    }

    const plain: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      plain[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : walkValue(entry, depth + 1, seen);
    }
    return plain;
  } finally {
    seen.delete(container);
  }
}

/**
 * Deep-walk any value, redacting strings, flattening errors, capping depth and
 * array length, and surviving cycles without throwing. Numbers, booleans and
 * `null` pass through untouched.
 */
export function redactValue(value: unknown): unknown {
  return walkValue(value, 0, new WeakSet<object>());
}

/**
 * Redact a structured-log field bag. On top of `redactValue`, any key whose
 * name matches {@link SENSITIVE_KEY_PATTERN} has its value replaced wholesale.
 */
export function redactFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  if (!fields) return redacted;
  const seen = new WeakSet<object>();
  for (const [key, value] of Object.entries(fields)) {
    redacted[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : walkValue(value, 1, seen);
  }
  return redacted;
}
