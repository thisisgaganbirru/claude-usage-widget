/**
 * The non-secret half of `~/.codex/auth.json`.
 *
 * This provider reads usage from files Codex already wrote, so it needs no
 * token and takes none: the only thing wanted here is an account label and a
 * plan, which live in the ID token's claims. The access and refresh tokens in
 * the same file are never read, never copied and never returned.
 *
 * The ID token's signature is not verified, and does not need to be. It is not
 * a trust decision: the file is the user's own, and the two claims taken from
 * it are strings rendered in a card. Anything able to forge it already had
 * write access to the user's home directory.
 */
import { promises as fs } from "fs";
import { isPlainObject } from "../schema";

/** Namespaced claim groups the Codex ID token uses. */
const PROFILE_CLAIM = "https://api.openai.com/profile";
const AUTH_CLAIM = "https://api.openai.com/auth";

/** Longest label we render. Both fields come from outside. */
const MAX_LABEL_LENGTH = 64;

export interface CodexAccount {
  /** Email from the ID token, or null when the file does not carry one. */
  email: string | null;
  /** "plus", "pro", "team": the plan the account is on. */
  planType: string | null;
}

const EMPTY: CodexAccount = { email: null, planType: null };

function readString(
  parent: Record<string, unknown>,
  key: string,
): string | null {
  const value = parent[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_LABEL_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The claims of a JWT, without verifying it. Returns null for anything that
 * is not three base64url segments with a JSON object in the middle.
 */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const segments = token.split(".");
  if (segments.length !== 3) return null;
  try {
    const json = Buffer.from(segments[1], "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseCodexAccount(json: unknown): CodexAccount {
  if (!isPlainObject(json)) return EMPTY;

  const tokens = json.tokens;
  if (!isPlainObject(tokens)) return EMPTY;

  const idToken = tokens.id_token;
  if (typeof idToken !== "string") return EMPTY;

  const claims = decodeJwtClaims(idToken);
  if (claims === null) return EMPTY;

  const profile = isPlainObject(claims[PROFILE_CLAIM])
    ? (claims[PROFILE_CLAIM] as Record<string, unknown>)
    : {};
  const auth = isPlainObject(claims[AUTH_CLAIM])
    ? (claims[AUTH_CLAIM] as Record<string, unknown>)
    : {};

  return {
    email: readString(profile, "email"),
    planType: readString(auth, "chatgpt_plan_type"),
  };
}

/**
 * The first candidate path that exists and parses, or null. A malformed
 * auth.json costs a label, not the reading, so it is not an error here.
 */
export async function readCodexAccount(
  candidates: string[],
): Promise<{ account: CodexAccount; file: string } | null> {
  for (const file of candidates) {
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    try {
      return { account: parseCodexAccount(JSON.parse(text)), file };
    } catch {
      return { account: EMPTY, file };
    }
  }
  return null;
}
