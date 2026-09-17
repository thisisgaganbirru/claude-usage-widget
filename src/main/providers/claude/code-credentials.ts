/**
 * Claude Code's own OAuth credential, read in place.
 *
 * Someone who lives in the terminal may never open claude.ai in a browser, and
 * signing into a widget to watch limits they can already see in their CLI is a
 * poor trade. Claude Code has already done the OAuth dance, so this reads what
 * it stored rather than asking for another one.
 *
 * Three rules this file does not bend:
 *
 * - **Nothing is ever written back.** Refreshing a token into a file another
 *   process owns is how you corrupt someone's login. An expired credential is
 *   reported as expired and the user re-runs `claude`.
 * - **A token without `user:profile` is not a credential.** `claude
 *   setup-token` mints an inference-only token that cannot call the usage
 *   endpoint at all, so accepting one buys a guaranteed 403 instead of falling
 *   through to a source that works.
 * - **The token never leaves the main process.** It is a `SecretCredential`,
 *   and `secret` does not cross the IPC boundary or reach a log line.
 */
import { execFile } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import { isPlainObject } from "../schema";

/** The file Claude Code writes. Note the leading dot. */
export const CREDENTIALS_FILE = ".credentials.json";

/** The macOS keychain item, which on a Mac is often the only copy. */
export const KEYCHAIN_SERVICE = "Claude Code-credentials";

/**
 * Treat a token expiring within this window as already expired. Claude Code
 * uses the same buffer, and it stops a poll racing the expiry it just passed.
 */
export const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Without this scope the usage endpoint answers 403, every time. */
export const REQUIRED_SCOPE = "user:profile";

const KEYCHAIN_TIMEOUT_MS = 5000;

export type ClaudeCodeSource = "file" | "keychain" | "env";

export interface ClaudeCodeCredentials {
  accessToken: string;
  /** Present but unused: this app never performs the refresh itself. */
  refreshToken: string | null;
  /** Milliseconds since the epoch, or null when the store carries no expiry. */
  expiresAt: number | null;
  /** Empty when the store predates the field, which is not a scope failure. */
  scopes: string[];
  /** "max", "pro": advisory, and only a fallback for the plan label. */
  subscriptionType: string | null;
  /** "default_claude_max_20x": the better of the two plan hints. */
  rateLimitTier: string | null;
}

export interface DiscoveredClaudeCode {
  credentials: ClaudeCodeCredentials;
  source: ClaudeCodeSource;
}

/** `$CLAUDE_CONFIG_DIR`, else `~/.claude`. */
export function claudeConfigDir(
  env: NodeJS.ProcessEnv,
  homeDir: string,
): string {
  const override = env.CLAUDE_CONFIG_DIR;
  if (typeof override === "string" && override.trim().length > 0) {
    return override.trim();
  }
  return path.join(homeDir, ".claude");
}

/**
 * Candidate credential files, most specific first.
 * `$CLAUDE_SECURESTORAGE_CONFIG_DIR` overrides the credentials directory on
 * its own, separately from the config root, so it is checked first.
 */
export function credentialsFileCandidates(
  env: NodeJS.ProcessEnv,
  homeDir: string,
): string[] {
  const candidates: string[] = [];
  const secure = env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  if (typeof secure === "string" && secure.trim().length > 0) {
    candidates.push(path.join(secure.trim(), CREDENTIALS_FILE));
  }
  candidates.push(path.join(claudeConfigDir(env, homeDir), CREDENTIALS_FILE));
  return candidates;
}

function readOptionalString(
  parent: Record<string, unknown>,
  key: string,
): string | null {
  const value = parent[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The `claudeAiOauth` block, or null for a store that does not carry one.
 *
 * Claude Code 2.1.x has been seen writing a keychain item holding only
 * `mcpOAuth`. That is a store without a Claude login in it, not a malformed
 * one, so it returns null and the ladder moves on.
 */
export function parseClaudeCodeCredentials(
  json: unknown,
): ClaudeCodeCredentials | null {
  if (!isPlainObject(json)) return null;
  const block = json.claudeAiOauth;
  if (!isPlainObject(block)) return null;

  const accessToken = readOptionalString(block, "accessToken");
  if (accessToken === null) return null;

  const expiresAt = block.expiresAt;
  const scopes = Array.isArray(block.scopes)
    ? block.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];

  return {
    accessToken,
    refreshToken: readOptionalString(block, "refreshToken"),
    expiresAt:
      typeof expiresAt === "number" &&
      Number.isFinite(expiresAt) &&
      expiresAt > 0
        ? expiresAt
        : null,
    scopes,
    subscriptionType: readOptionalString(block, "subscriptionType"),
    rateLimitTier: readOptionalString(block, "rateLimitTier"),
  };
}

/**
 * Whether a credential can actually be used for a usage read.
 *
 * A store that lists no scopes at all predates the field rather than lacking
 * the scope, so it is allowed through; a store that lists scopes and omits
 * `user:profile` is refused.
 */
export function isUsable(
  credentials: ClaudeCodeCredentials,
  now: number = Date.now(),
): boolean {
  if (
    credentials.scopes.length > 0 &&
    !credentials.scopes.includes(REQUIRED_SCOPE)
  ) {
    return false;
  }
  if (credentials.expiresAt === null) return true;
  return credentials.expiresAt - REFRESH_BUFFER_MS > now;
}

/**
 * Undo the hex encoding macOS applies to a keychain password holding any
 * non-printable byte, which a pretty-printed JSON payload triggers. JSON
 * starts with `{`, never a hex digit, so an all-hex payload is unambiguous.
 */
export function decodeKeychainPayload(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return trimmed;
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(trimmed)) return trimmed;
  return Buffer.from(trimmed, "hex").toString("utf8");
}

export type KeychainReader = (service: string) => Promise<string | null>;

/** Reads the keychain item through the `security` CLI. macOS only. */
export const readKeychainItem: KeychainReader = (service) =>
  new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-s", service, "-w"],
      { timeout: KEYCHAIN_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(stdout);
      },
    );
  });

export interface DiscoverOptions {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  platform: NodeJS.Platform;
  /** Injected so the ladder is testable off a Mac. */
  readKeychain?: KeychainReader;
  now?: number;
}

async function fromFiles(
  candidates: string[],
): Promise<ClaudeCodeCredentials | null> {
  for (const file of candidates) {
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    try {
      const parsed = parseClaudeCodeCredentials(JSON.parse(text));
      if (parsed !== null) return parsed;
    } catch {
      // A half-written file is worth stepping over, not failing on.
    }
  }
  return null;
}

/**
 * The first source that yields a usable credential, or null.
 *
 * Order is deliberate. The file and the keychain hold the token from a full
 * sign-in; `CLAUDE_CODE_OAUTH_TOKEN` usually holds one from `claude
 * setup-token`, which cannot read usage, so it goes last and only stands in
 * when nothing else answered.
 */
export async function discoverClaudeCodeCredentials(
  options: DiscoverOptions,
): Promise<DiscoveredClaudeCode | null> {
  const { env, homeDir, platform } = options;
  const now = options.now ?? Date.now();

  const fromFile = await fromFiles(credentialsFileCandidates(env, homeDir));
  if (fromFile !== null && isUsable(fromFile, now)) {
    return { credentials: fromFile, source: "file" };
  }

  if (platform === "darwin") {
    const read = options.readKeychain ?? readKeychainItem;
    const raw = await read(KEYCHAIN_SERVICE);
    if (raw !== null) {
      try {
        const parsed = parseClaudeCodeCredentials(
          JSON.parse(decodeKeychainPayload(raw)),
        );
        if (parsed !== null && isUsable(parsed, now)) {
          return { credentials: parsed, source: "keychain" };
        }
      } catch {
        // Same reasoning as the file: step over it.
      }
    }
  }

  const token = env.CLAUDE_CODE_OAUTH_TOKEN;
  if (typeof token === "string" && token.trim().length > 0) {
    return {
      credentials: {
        accessToken: token.trim(),
        refreshToken: null,
        expiresAt: null,
        scopes: [],
        subscriptionType: null,
        rateLimitTier: null,
      },
      source: "env",
    };
  }

  return null;
}
