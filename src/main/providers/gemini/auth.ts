/**
 * Reading the Gemini CLI's stored Google credential.
 *
 * The CLI writes `~/.gemini/oauth_creds.json` after a sign-in and rewrites it
 * each time it refreshes. This provider reads that file and never writes it:
 * a refresh written back into a file another process owns is how you corrupt
 * someone's login to save them a click.
 *
 * Not refreshing has a cost worth stating plainly. Google's access tokens last
 * about an hour, so the credential here is only usable for a while after the
 * CLI last ran. Refreshing it ourselves would mean holding Google OAuth client
 * credentials belonging to the Gemini CLI, which is a different kind of
 * decision from reading a file the user already has, and it is not one this
 * provider makes on its own. `TokenRefresher` is the seam that flow plugs into
 * if it is ever authorised; with no refresher the expired case is reported as
 * needing a sign-in, which is honest and costs nothing.
 *
 * `scope` is checked before the token is treated as a credential: the CLI can
 * hold a token minted for something narrower, and spending a request on a
 * guaranteed 403 tells the user nothing.
 *
 * The access and refresh tokens never leave the main process.
 */
import { promises as fs } from "fs";
import { isPlainObject } from "../schema";

/** The scope the Code Assist quota endpoints require. */
export const REQUIRED_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** Treat a token expiring within this window as already expired. */
export const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const MAX_LABEL_LENGTH = 64;

export interface GeminiCredentials {
  accessToken: string;
  refreshToken: string | null;
  /** Unix milliseconds, as the CLI writes it, or null when absent. */
  expiryDate: number | null;
  scopes: string[];
}

/**
 * Exchanges a refresh token for a fresh access token, in memory. Left
 * unimplemented on purpose; see the module comment.
 */
export type TokenRefresher = (
  refreshToken: string,
) => Promise<{ accessToken: string; expiryDate: number | null }>;

function readString(
  parent: Record<string, unknown>,
  key: string,
): string | null {
  const value = parent[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * `scope` is a space-separated string in Google's token responses, but the
 * CLI has also written it as an array. Both are read.
 */
export function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value !== "string") return [];
  return value.split(/\s+/).filter((entry) => entry.length > 0);
}

export function parseGeminiCredentials(
  json: unknown,
): GeminiCredentials | null {
  if (!isPlainObject(json)) return null;

  const accessToken = readString(json, "access_token");
  if (accessToken === null) return null;

  const expiry = json.expiry_date;

  return {
    accessToken,
    refreshToken: readString(json, "refresh_token"),
    expiryDate:
      typeof expiry === "number" && Number.isFinite(expiry) ? expiry : null,
    scopes: parseScopes(json.scope),
  };
}

/**
 * Whether the token can be spent now. A credential with no expiry recorded is
 * taken at face value: the vendor is the authority on that, and a 401 is
 * handled as an auth error anyway.
 */
export function isUsable(
  credentials: GeminiCredentials,
  now: number = Date.now(),
): boolean {
  if (!credentials.scopes.includes(REQUIRED_SCOPE)) return false;
  if (credentials.expiryDate === null) return true;
  return credentials.expiryDate - REFRESH_BUFFER_MS > now;
}

/** The email the CLI recorded as active, for the card's label. */
export function parseActiveAccount(json: unknown): string | null {
  if (!isPlainObject(json)) return null;
  const active = readString(json, "active");
  if (active === null) return null;
  return active.slice(0, MAX_LABEL_LENGTH);
}

async function readJsonFile(file: string): Promise<unknown> {
  const text = await fs.readFile(file, "utf8");
  return JSON.parse(text) as unknown;
}

export interface DiscoveredGemini {
  credentials: GeminiCredentials;
  email: string | null;
  /** The file it came from. A path, safe to log. */
  source: string;
}

export interface DiscoverGeminiOptions {
  credsFile: string;
  accountsFile: string;
  refresh?: TokenRefresher;
  now?: number;
}

/**
 * The stored credential, refreshed in memory if a refresher was supplied and
 * the token has aged out. Returns null when the CLI has not signed in here;
 * an expired credential with no way to renew it is returned as it is, so the
 * caller can say "sign in again" rather than "not detected".
 */
export async function discoverGeminiCredentials(
  options: DiscoverGeminiOptions,
): Promise<DiscoveredGemini | null> {
  let parsed: GeminiCredentials | null;
  try {
    parsed = parseGeminiCredentials(await readJsonFile(options.credsFile));
  } catch {
    return null;
  }
  if (parsed === null) return null;

  const now = options.now ?? Date.now();
  let credentials = parsed;

  if (
    !isUsable(credentials, now) &&
    options.refresh !== undefined &&
    credentials.refreshToken !== null &&
    credentials.scopes.includes(REQUIRED_SCOPE)
  ) {
    try {
      const renewed = await options.refresh(credentials.refreshToken);
      credentials = {
        ...credentials,
        accessToken: renewed.accessToken,
        expiryDate: renewed.expiryDate,
      };
    } catch {
      // Fall through with the stored credential; the caller reports it as
      // expired rather than treating a failed renewal as "not detected".
    }
  }

  let email: string | null = null;
  try {
    email = parseActiveAccount(await readJsonFile(options.accountsFile));
  } catch {
    // The account file is a label, not a credential. Its absence is fine.
  }

  return { credentials, email, source: options.credsFile };
}
