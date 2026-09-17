/**
 * Where the Gemini CLI keeps its state.
 *
 * `GEMINI_DIR` overrides the default, which is how the CLI's own tests and
 * multi-account setups work. Everything here takes the environment and the
 * home directory as arguments rather than reading them, which keeps the path
 * logic testable on any OS.
 */
import * as path from "path";

export const CREDS_FILE = "oauth_creds.json";
export const ACCOUNTS_FILE = "google_accounts.json";

/** `$GEMINI_DIR`, else `~/.gemini`. */
export function geminiHome(env: NodeJS.ProcessEnv, homeDir: string): string {
  const override = env.GEMINI_DIR;
  if (typeof override === "string" && override.trim().length > 0) {
    return override.trim();
  }
  return path.join(homeDir, ".gemini");
}

export function credsFile(env: NodeJS.ProcessEnv, homeDir: string): string {
  return path.join(geminiHome(env, homeDir), CREDS_FILE);
}

export function accountsFile(env: NodeJS.ProcessEnv, homeDir: string): string {
  return path.join(geminiHome(env, homeDir), ACCOUNTS_FILE);
}
