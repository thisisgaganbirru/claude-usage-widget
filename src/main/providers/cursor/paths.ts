/**
 * Where the Cursor editor keeps its global state.
 *
 * Cursor is a VS Code fork, so it inherits VS Code's per-platform layout:
 * `<user data dir>/User/globalStorage/state.vscdb`, a SQLite database whose
 * `ItemTable` holds every global key the editor has written, the sign-in
 * tokens among them.
 *
 * Everything here takes the environment, the home directory and the platform
 * as arguments rather than reading them, so the path logic is testable on
 * any OS.
 */
import * as path from "path";

export const STATE_DB = "state.vscdb";
export const CURSOR_DIR = "Cursor";

export interface StateDbOptions {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  platform: NodeJS.Platform;
}

function stateDbUnder(userDataDir: string): string {
  return path.join(userDataDir, "User", "globalStorage", STATE_DB);
}

/**
 * Candidate database paths, most likely first.
 *
 * The Linux branch checks `$XDG_CONFIG_HOME` before `~/.config` because a
 * machine that sets it does not have the second directory at all, and falls
 * through to `~/.config` anyway for the far more common case where it is
 * unset.
 */
export function stateDbCandidates(options: StateDbOptions): string[] {
  const { env, homeDir, platform } = options;

  if (platform === "darwin") {
    return [
      stateDbUnder(
        path.join(homeDir, "Library", "Application Support", CURSOR_DIR),
      ),
    ];
  }

  if (platform === "win32") {
    const appData = env.APPDATA;
    const candidates: string[] = [];
    if (typeof appData === "string" && appData.trim().length > 0) {
      candidates.push(stateDbUnder(path.join(appData.trim(), CURSOR_DIR)));
    }
    candidates.push(
      stateDbUnder(path.join(homeDir, "AppData", "Roaming", CURSOR_DIR)),
    );
    return candidates;
  }

  const xdg = env.XDG_CONFIG_HOME;
  const candidates: string[] = [];
  if (typeof xdg === "string" && xdg.trim().length > 0) {
    candidates.push(stateDbUnder(path.join(xdg.trim(), CURSOR_DIR)));
  }
  candidates.push(stateDbUnder(path.join(homeDir, ".config", CURSOR_DIR)));
  return candidates;
}
