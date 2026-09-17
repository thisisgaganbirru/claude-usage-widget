/**
 * Reading the claims of a token we already hold.
 *
 * Two providers need this: Codex takes an email and a plan out of an ID
 * token, and Cursor takes the user id out of an access token to build the
 * session cookie the vendor's own client sends.
 *
 * The signature is never verified, and does not need to be. It is not a trust
 * decision: the token is the user's own, sitting in their own home directory,
 * and what comes out of it is a label and an opaque id. Anything able to forge
 * it already had write access to that directory.
 */
import { isPlainObject } from "./schema";

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
