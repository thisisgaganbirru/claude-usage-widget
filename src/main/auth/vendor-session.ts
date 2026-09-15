/**
 * Per-vendor Electron sessions.
 *
 * The login window used to sign in against `session.defaultSession`, which
 * meant Claude's cookies, ChatGPT's cookies and anything else the app ever
 * loaded shared one jar. Signing out of one vendor could not be done without
 * touching the others, and a page loaded for one vendor could read cookies
 * set for the other.
 *
 * Each vendor now gets its own persistent partition. The jar is created
 * lazily, hardened the same way every other session is, and carries the
 * desktop Chrome user agent so vendor pages render the normal web experience.
 */
import { session } from "electron";
import type { Session } from "electron";
import { createLogger } from "@main/logging/logger";
import { hardenSession } from "@main/security/policy";
import {
  CHROME_USER_AGENT,
  getLoginPolicy,
  listVendorPartitions,
} from "@main/auth/login-policy";
import type { ProviderType } from "@shared/types";

const log = createLogger("auth:vendor-session");

const prepared = new Set<string>();

/**
 * The session for a vendor, created and hardened on first use.
 *
 * Call this before creating the window that will use it: a session-wide user
 * agent applies to WebContents created after it is set, which is what lets
 * OAuth popups inherit it without any per-window wiring.
 */
export function getVendorSession(provider: ProviderType): Session {
  const policy = getLoginPolicy(provider);
  const vendorSession = session.fromPartition(policy.partition);

  if (!prepared.has(policy.partition)) {
    prepared.add(policy.partition);
    hardenSession(vendorSession);
    vendorSession.setUserAgent(CHROME_USER_AGENT);
    log.info("vendor session prepared", { provider });
  }

  return vendorSession;
}

/**
 * Remove every cookie this vendor set. Used when the user signs out, so the
 * next sign-in starts from a genuinely empty jar rather than silently
 * resuming the session that was just discarded.
 */
export async function clearVendorCookies(
  provider: ProviderType,
): Promise<void> {
  const policy = getLoginPolicy(provider);
  const vendorSession = getVendorSession(provider);
  let removed = 0;

  try {
    for (const origin of policy.cookieOrigins) {
      const cookies = await vendorSession.cookies.get({ url: origin });
      for (const cookie of cookies) {
        await vendorSession.cookies.remove(origin, cookie.name);
        removed += 1;
      }
    }
    log.info("vendor cookies cleared", { provider, removed });
  } catch (error) {
    log.error("failed to clear vendor cookies", {
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Drop every vendor partition's storage, not just its cookies. This is the
 * heavy option behind a full sign-out of everything.
 */
export async function clearAllVendorStorage(): Promise<void> {
  for (const partition of listVendorPartitions()) {
    try {
      await session.fromPartition(partition).clearStorageData();
    } catch (error) {
      log.error("failed to clear vendor storage", {
        partition,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
