/**
 * The Copilot OAuth token, read from the editor plugin's own file.
 *
 * `apps.json` is keyed by `"<host>:<GitHub App client id>"`, and the client id
 * changes with the editor. Rather than hardcode one, this takes the first
 * entry that carries an `oauth_token`, preferring a `github.com` key so that a
 * machine signed into both github.com and an enterprise host resolves to the
 * one the endpoints below expect.
 *
 * The token is a long-lived `gho_` credential with no expiry and no refresh.
 * It is read, used as a header, and never written anywhere.
 */
import { promises as fs } from "fs";
import { isPlainObject } from "../schema";

const GITHUB_HOST = "github.com";
const MAX_LABEL_LENGTH = 64;

export interface CopilotToken {
  token: string;
  /** GitHub login, shown as the account label. Not a secret. */
  user: string | null;
  /** The host the key named, for an enterprise install. */
  host: string;
}

function readLabel(
  parent: Record<string, unknown>,
  key: string,
): string | null {
  const value = parent[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_LABEL_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

export function parseAppsFile(json: unknown): CopilotToken | null {
  if (!isPlainObject(json)) return null;

  const entries: CopilotToken[] = [];
  for (const [key, value] of Object.entries(json)) {
    if (!isPlainObject(value)) continue;
    const token = value.oauth_token;
    if (typeof token !== "string" || token.trim().length === 0) continue;
    entries.push({
      token: token.trim(),
      user: readLabel(value, "user"),
      host: key.split(":")[0] || GITHUB_HOST,
    });
  }

  if (entries.length === 0) return null;
  return entries.find((entry) => entry.host === GITHUB_HOST) ?? entries[0];
}

/** The first candidate that exists and carries a token, or null. */
export async function readCopilotToken(
  candidates: string[],
): Promise<CopilotToken | null> {
  for (const file of candidates) {
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    try {
      const parsed = parseAppsFile(JSON.parse(text));
      if (parsed !== null) return parsed;
    } catch {
      // A half-written file is worth stepping over, not failing on.
    }
  }
  return null;
}
