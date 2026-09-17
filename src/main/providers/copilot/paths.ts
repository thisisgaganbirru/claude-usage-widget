/**
 * Where the Copilot editor plugins keep their OAuth token.
 *
 * One file, two locations, split by platform. Both are taken as arguments
 * rather than read from the process, so the resolution is testable on any OS.
 */
import * as path from "path";

export const APPS_FILE = "apps.json";
export const COPILOT_DIR = "github-copilot";

export interface CopilotPathEnv {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  platform: NodeJS.Platform;
}

/**
 * Candidate `apps.json` paths, most likely first.
 *
 * Windows keeps it under `%LOCALAPPDATA%`; everything else uses
 * `~/.config`. The other platform's path is still offered as a fallback,
 * because a machine that has been migrated between the two can carry either.
 */
export function appsFileCandidates(options: CopilotPathEnv): string[] {
  const { env, homeDir, platform } = options;
  const xdg = path.join(homeDir, ".config", COPILOT_DIR, APPS_FILE);

  if (platform !== "win32") return [xdg];

  const localAppData = env.LOCALAPPDATA;
  const candidates: string[] = [];
  if (typeof localAppData === "string" && localAppData.trim().length > 0) {
    candidates.push(path.join(localAppData.trim(), COPILOT_DIR, APPS_FILE));
  }
  candidates.push(
    path.join(homeDir, "AppData", "Local", COPILOT_DIR, APPS_FILE),
    xdg,
  );
  return candidates;
}
