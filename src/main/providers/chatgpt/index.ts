/**
 * ChatGPT provider.
 *
 * Credential: the chatgpt.com session cookie captured by the sign-in window.
 * Data source: `sentinel/chat-requirements` for the quota and the account-check
 * endpoint for the plan label. Neither is documented, which is why the
 * normalizer searches for a quota shape rather than asserting one — and why it
 * emits nothing for a window it cannot find.
 *
 * Headers are listed here per ADR-0003. The User-Agent is carried over from
 * 1.0; see the note in the Claude provider.
 */
import { SessionManager } from "@main/auth/session-manager";
import { createLogger } from "@main/logging/logger";
import type { ProviderUsage } from "@shared/usage";
import { httpGet } from "../http";
import { ProviderError, type Credential, type UsageProvider } from "../types";
import {
  normalizeChatGptUsage,
  parseChatGptAccount,
  type ChatGptAccount,
} from "./normalize";

const log = createLogger("providers/chatgpt");

const REQUIREMENTS_URL =
  "https://chatgpt.com/backend-api/sentinel/chat-requirements";
const ACCOUNT_URL =
  "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27";

const WEB_APP_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  Referer: "https://chatgpt.com/",
};

function requestHeaders(cookie: string): Record<string, string> {
  return { ...WEB_APP_HEADERS, Cookie: cookie };
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const chatgptProvider: UsageProvider = {
  id: "chatgpt",
  displayName: "ChatGPT",
  defaultIntervalSec: 60,

  async discoverCredentials(): Promise<Credential | null> {
    const cookie = SessionManager.getSessionCookie("chatgpt");
    if (cookie === null || cookie.length === 0) return null;
    const account = SessionManager.getActiveAccount("chatgpt");
    return {
      providerId: "chatgpt",
      kind: "cookie",
      secret: cookie,
      expiresAt: null,
      accountLabel: account?.displayName,
    };
  },

  async fetchUsage(cred: Credential): Promise<ProviderUsage> {
    if (cred.kind !== "cookie") {
      throw new ProviderError(
        "auth",
        "The ChatGPT provider needs a session cookie",
      );
    }

    const headers = requestHeaders(cred.secret);
    const [requirements, account] = await Promise.allSettled([
      httpGet({ url: REQUIREMENTS_URL, headers }),
      httpGet({ url: ACCOUNT_URL, headers }),
    ]);

    // The quota endpoint is the one that must succeed. An auth failure on it
    // means the cookie is dead, which the scheduler handles differently from a
    // transient network error, so it is rethrown with its kind intact.
    if (requirements.status === "rejected") {
      throw requirements.reason instanceof ProviderError
        ? requirements.reason
        : new ProviderError("network", "ChatGPT quota request failed", {
            cause: requirements.reason,
            context: REQUIREMENTS_URL,
          });
    }

    // The account endpoint only supplies a label and a plan string. Losing it
    // costs cosmetics, not the reading, so a failure here is not fatal.
    let parsedAccount: ChatGptAccount = { accountLabel: null, plan: null };
    if (account.status === "fulfilled") {
      parsedAccount = parseChatGptAccount(parseJsonOrNull(account.value));
    } else {
      log.debug("account lookup failed, continuing without a plan label");
    }
    if (
      parsedAccount.accountLabel === null &&
      cred.accountLabel !== undefined
    ) {
      parsedAccount = {
        ...parsedAccount,
        accountLabel: cred.accountLabel,
      };
    }

    return normalizeChatGptUsage(parseJsonOrNull(requirements.value), {
      account: parsedAccount,
      fetchedAt: new Date().toISOString(),
    });
  },
};
