/**
 * Codex provider.
 *
 * Credential: none. Codex CLI already writes every rate-limit snapshot the
 * vendor returns into its own rollout logs, so this adapter reads files the
 * machine has rather than asking for a login. That is the whole point of the
 * `LocalCredential` shape: there is no secret here to hold, leak or refresh.
 *
 * Deliberately not implemented: the live `chatgpt.com/backend-api/wham/usage`
 * read. It needs the bearer from `auth.json`, and this build has no token
 * refresh, so an access token older than its lifetime would 401 — an `auth`
 * error, which stops the scheduler polling Codex at all. Local reading keeps
 * working in exactly that case, so it is the better of the two until refresh
 * exists.
 */
import * as os from "os";
import { createLogger } from "@main/logging/logger";
import type { ProviderUsage } from "@shared/usage";
import { ProviderError, type Credential, type UsageProvider } from "../types";
import { readCodexAccount, type CodexAccount } from "./auth";
import { normalizeCodexSnapshot } from "./normalize";
import { authFileCandidates, codexHome, sessionsDir } from "./paths";
import { findLatestSnapshot } from "./rollout";

const log = createLogger("providers/codex");

/**
 * Codex writes a snapshot on every turn, so a snapshot is only as fresh as the
 * last time the user ran it. Polling it hard buys nothing, and the read costs
 * a directory walk.
 */
const DEFAULT_INTERVAL_SEC = 120;

const NO_ACCOUNT: CodexAccount = { email: null, planType: null };

function accountLabelFor(account: CodexAccount, home: string): string {
  return account.email ?? `Local (${home})`;
}

export const codexProvider: UsageProvider = {
  id: "codex",
  displayName: "Codex",
  defaultIntervalSec: DEFAULT_INTERVAL_SEC,

  /**
   * "Detected" means Codex has state on this machine: an auth file, or a
   * sessions directory it has written into. Neither one is a secret, so the
   * credential carries the path and nothing else.
   */
  async discoverCredentials(): Promise<Credential | null> {
    const home = codexHome(process.env, os.homedir());
    const found = await readCodexAccount(
      authFileCandidates(process.env, os.homedir()),
    );

    if (found === null) {
      const snapshot = await findLatestSnapshot(
        sessionsDir(process.env, os.homedir()),
      );
      if (snapshot === null) return null;
    }

    const account = found?.account ?? NO_ACCOUNT;
    return {
      providerId: "codex",
      kind: "local",
      source: home,
      expiresAt: null,
      accountLabel: accountLabelFor(account, home),
    };
  },

  async fetchUsage(cred: Credential): Promise<ProviderUsage> {
    if (cred.kind !== "local") {
      throw new ProviderError(
        "auth",
        "The Codex provider reads local files and takes no secret",
      );
    }

    const found = await readCodexAccount(
      authFileCandidates(process.env, os.homedir()),
    );
    const account = found?.account ?? NO_ACCOUNT;
    const accountLabel =
      cred.accountLabel ?? accountLabelFor(account, cred.source);

    const snapshot = await findLatestSnapshot(
      sessionsDir(process.env, os.homedir()),
    );

    // No snapshot is not an error: Codex is installed and has simply not been
    // run far enough for the vendor to report a limit. An empty window list is
    // how the card says so, and it is the only place one is produced.
    if (snapshot === null) {
      log.debug("no rate-limit snapshot on disk yet");
      return {
        providerId: "codex",
        accountLabel,
        plan: account.planType,
        windows: [],
        fetchedAt: new Date().toISOString(),
      };
    }

    log.debug("read snapshot", { file: snapshot.file });

    // `fetchedAt` is when the numbers were true, not when we read them. The
    // scheduler drives staleness from its own timer, so an honest timestamp
    // here costs nothing and stops the card claiming a percentage is current
    // when the last Codex turn was yesterday.
    return normalizeCodexSnapshot(snapshot.rateLimits, {
      accountLabel,
      fetchedAt: snapshot.recordedAt ?? new Date().toISOString(),
      plan: account.planType,
    });
  },
};
