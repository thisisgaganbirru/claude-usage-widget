/**
 * Cursor provider.
 *
 * Credential: the access token the Cursor editor already stored in its
 * `state.vscdb`, turned into the `WorkosCursorSessionToken` cookie its own
 * client sends. Nothing is written to Cursor's directory and no login window
 * is shown.
 *
 * Data source: `cursor.com/api/usage-summary`, which is what the Cursor
 * dashboard calls for the same numbers.
 *
 * There is no refresh. Cursor's token carries an expiry and only the editor
 * can mint a new one, so an expired credential is reported as expired and the
 * card asks for a sign-in rather than the app trying to renew a token it does
 * not own. Writing a fresh token back into a database the editor has open
 * would corrupt someone's sign-in to save them one click.
 *
 * Headers are listed here per ADR-0003: the app identity Cursor's own client
 * sends, and no browser User-Agent.
 */
import * as os from "os";
import { createLogger } from "@main/logging/logger";
import type { ProviderUsage } from "@shared/usage";
import { httpGet } from "../http";
import { decodeJwtClaims } from "../jwt";
import { parseJson } from "../schema";
import { ProviderError, type Credential, type UsageProvider } from "../types";
import { readCursorAuth, sessionCookie } from "./auth";
import { normalizeCursorUsage } from "./normalize";
import { stateDbCandidates } from "./paths";

const log = createLogger("providers/cursor");

export const USAGE_URL = "https://cursor.com/api/usage-summary";

/** Spend and request counts move slowly, so a slow cadence loses nothing. */
const DEFAULT_INTERVAL_SEC = 300;

const REQUEST_HEADERS: Readonly<Record<string, string>> = {
  Accept: "application/json",
  "User-Agent": "Cursor/1.7.0",
};

/**
 * The membership Cursor cached at sign-in, kept from the last discovery so a
 * response that omits `membershipType` still names a plan. The scheduler runs
 * `discoverCredentials` immediately before every fetch, so this is never
 * older than the credential being used.
 */
let cachedMembership: string | null = null;

/** Clears the cached plan label. Called when the account changes. */
export function clearCursorCache(): void {
  cachedMembership = null;
}

function candidates(): string[] {
  return stateDbCandidates({
    env: process.env,
    homeDir: os.homedir(),
    platform: process.platform,
  });
}

/** The token's own `exp` claim as an ISO timestamp, or null. */
function expiryOf(token: string): string | null {
  const claims = decodeJwtClaims(token);
  const exp = claims?.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  return new Date(exp * 1000).toISOString();
}

export const cursorProvider: UsageProvider = {
  id: "cursor",
  displayName: "Cursor",
  defaultIntervalSec: DEFAULT_INTERVAL_SEC,

  async discoverCredentials(): Promise<Credential | null> {
    const found = await readCursorAuth(candidates());
    if (found === null) {
      cachedMembership = null;
      return null;
    }

    // A token whose id we cannot read cannot be turned into the cookie, so it
    // is not a usable credential and saying so here beats a 401 later.
    if (sessionCookie(found.accessToken) === null) {
      log.warn("state.vscdb holds a token in an unexpected shape", {
        source: found.source,
      });
      return null;
    }

    cachedMembership = found.membership;
    log.debug("found a Cursor sign-in", { source: found.source });

    return {
      providerId: "cursor",
      kind: "cookie",
      secret: found.accessToken,
      expiresAt: expiryOf(found.accessToken),
      accountLabel: found.email ?? undefined,
    };
  },

  async fetchUsage(cred: Credential): Promise<ProviderUsage> {
    if (cred.kind !== "cookie") {
      throw new ProviderError(
        "auth",
        "The Cursor provider needs the editor's session token",
      );
    }

    const cookie = sessionCookie(cred.secret);
    if (cookie === null) {
      throw new ProviderError(
        "auth",
        "Cursor's session token could not be read. Sign in to Cursor again.",
      );
    }

    const body = await httpGet({
      url: USAGE_URL,
      headers: { ...REQUEST_HEADERS, Cookie: cookie },
    });
    log.debug("usage response received", { bytes: body.length });

    return normalizeCursorUsage(parseJson(body, "usage-summary"), {
      accountLabel: cred.accountLabel ?? "Cursor",
      membership: cachedMembership,
      fetchedAt: new Date().toISOString(),
    });
  },
};
