/**
 * Where the Codex CLI keeps its state.
 *
 * `CODEX_HOME` overrides the default, which is how the CLI's own tests and
 * multi-account setups work, so honouring it is not optional. Everything here
 * takes the environment and the home directory as arguments rather than
 * reading them, which keeps the path logic testable on any OS.
 */
import * as path from "path";

export const SESSIONS_SUBDIR = "sessions";
export const AUTH_FILE = "auth.json";

/** `$CODEX_HOME`, else `~/.codex`. */
export function codexHome(env: NodeJS.ProcessEnv, homeDir: string): string {
  const override = env.CODEX_HOME;
  if (typeof override === "string" && override.trim().length > 0) {
    return override.trim();
  }
  return path.join(homeDir, ".codex");
}

/**
 * Candidate auth files, most authoritative first. The XDG-style location is a
 * legacy path the CLI used to write; a machine that has both should be read
 * from the current one.
 */
export function authFileCandidates(
  env: NodeJS.ProcessEnv,
  homeDir: string,
): string[] {
  return [
    path.join(codexHome(env, homeDir), AUTH_FILE),
    path.join(homeDir, ".config", "codex", AUTH_FILE),
  ];
}

export function sessionsDir(env: NodeJS.ProcessEnv, homeDir: string): string {
  return path.join(codexHome(env, homeDir), SESSIONS_SUBDIR);
}
