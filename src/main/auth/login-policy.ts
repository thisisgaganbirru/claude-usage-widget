/**
 * Per-vendor rules for the embedded login window.
 *
 * Like `url-policy.ts`, this module imports nothing from `electron`, so every
 * decision below can be exercised in a plain Node test process. The electron
 * wiring lives in `vendor-session.ts` and `login-window.ts`.
 *
 * Two properties matter here:
 *
 * - Each vendor gets its own persistent partition. Claude's cookies and
 *   ChatGPT's cookies never share a jar, and neither shares a jar with the
 *   default session the rest of the app uses.
 * - Post-login detection is made from a parsed origin and path, never from a
 *   string prefix. `https://claude.ai/login` is the login page, but so is
 *   `https://claude.ai/login/sso`, while `https://claude.ai.evil.example/`
 *   is not claude.ai at all and `https://claude.ai/@x/` is not a login page.
 */
import type { ProviderType } from "@shared/types";
import { originOf, parseUrl } from "@main/security/url-policy";

/**
 * A current desktop Chrome user agent. Both vendors serve a degraded or
 * blocked experience to Electron's default user agent string.
 */
export const CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * Third-party identity providers both vendors offer as sign-in buttons. These
 * are the only origins allowed to open a real popup window, because that is
 * how their OAuth flows are built and nothing else in the login window has a
 * reason to spawn one.
 */
const IDENTITY_ORIGINS: readonly string[] = [
  "https://accounts.google.com",
  "https://appleid.apple.com",
  "https://login.microsoftonline.com",
];

/**
 * Cloudflare's bot challenge, embedded as a subframe on both login pages. It
 * is a navigation target rather than a popup, so it is allowed to load but
 * never to open a window.
 */
const CHALLENGE_ORIGINS: readonly string[] = [
  "https://challenges.cloudflare.com",
];

export interface LoginPolicy {
  readonly provider: ProviderType;
  readonly title: string;
  readonly productName: string;
  /** Partition name for this vendor's cookie jar and storage. */
  readonly partition: string;
  /** The page the login window opens on. */
  readonly loginUrl: string;
  /** The vendor's application origin, where a signed-in session lands. */
  readonly appOrigin: string;
  /** Origins whose cookies may carry this vendor's session token. */
  readonly cookieOrigins: readonly string[];
  /** Origins the login window, and any popup it opens, may navigate to. */
  readonly navigateOrigins: readonly string[];
  /** Origins allowed to open a popup window. */
  readonly popupOrigins: readonly string[];
  /**
   * Paths under `appOrigin` that are still part of signing in. Reaching any
   * other path on that origin means the user is through.
   */
  readonly authPaths: readonly string[];
}

const LOGIN_POLICIES: Record<ProviderType, LoginPolicy> = {
  claude: {
    provider: "claude",
    title: "Sign in to Claude",
    productName: "Claude",
    partition: "persist:vendor-claude",
    loginUrl: "https://claude.ai/login",
    appOrigin: "https://claude.ai",
    cookieOrigins: ["https://claude.ai"],
    navigateOrigins: [
      "https://claude.ai",
      "https://auth.anthropic.com",
      ...IDENTITY_ORIGINS,
      ...CHALLENGE_ORIGINS,
    ],
    popupOrigins: IDENTITY_ORIGINS,
    authPaths: ["/login", "/auth", "/magic-link", "/logout"],
  },
  chatgpt: {
    provider: "chatgpt",
    title: "Sign in to ChatGPT",
    productName: "ChatGPT",
    partition: "persist:vendor-chatgpt",
    loginUrl: "https://chatgpt.com/auth/login",
    appOrigin: "https://chatgpt.com",
    cookieOrigins: ["https://chatgpt.com", "https://openai.com"],
    navigateOrigins: [
      "https://chatgpt.com",
      "https://auth.openai.com",
      "https://auth0.openai.com",
      "https://openai.com",
      ...IDENTITY_ORIGINS,
      ...CHALLENGE_ORIGINS,
    ],
    popupOrigins: IDENTITY_ORIGINS,
    authPaths: ["/auth", "/login", "/api/auth", "/logout"],
  },
};

export function getLoginPolicy(provider: ProviderType): LoginPolicy {
  return LOGIN_POLICIES[provider];
}

/** Every vendor partition, for callers that need to clear all of them. */
export function listVendorPartitions(): string[] {
  return Object.values(LOGIN_POLICIES).map((policy) => policy.partition);
}

/**
 * True when `pathname` is `prefix` or lives under it. Compared segment by
 * segment, so `/login` matches `/login/sso` but not `/loginhelp`.
 */
function isPathUnder(pathname: string, prefix: string): boolean {
  if (pathname === prefix) return true;
  return pathname.startsWith(`${prefix}/`);
}

/**
 * True when `raw` is a page the user only reaches once signed in.
 *
 * The URL must be on the vendor's own application origin and outside every
 * path that is still part of the sign-in flow. An identity provider's URL is
 * never a post-login URL, however far through the flow it is, because the
 * session cookie is set by the vendor and not by Google or Apple.
 */
export function isPostLoginUrl(policy: LoginPolicy, raw: string): boolean {
  const url = parseUrl(raw);
  if (!url) return false;
  if (url.origin !== policy.appOrigin) return false;
  return !policy.authPaths.some((prefix) => isPathUnder(url.pathname, prefix));
}

/** Host part of each origin whose cookies belong to this vendor. */
function cookieHosts(policy: LoginPolicy): string[] {
  return policy.cookieOrigins
    .map((origin) => parseUrl(origin)?.hostname ?? null)
    .filter((host): host is string => host !== null);
}

/**
 * True when a cookie's `domain` attribute belongs to this vendor.
 *
 * Cookie domains carry an optional leading dot and cover subdomains, so the
 * comparison is a suffix match on host boundaries. A substring test would
 * accept `claude.ai.evil.example`.
 */
export function isVendorCookieDomain(
  policy: LoginPolicy,
  domain: string | undefined,
): boolean {
  if (!domain) return false;
  const normalized = domain.startsWith(".") ? domain.slice(1) : domain;
  if (normalized.length === 0) return false;
  return cookieHosts(policy).some(
    (host) => normalized === host || normalized.endsWith(`.${host}`),
  );
}

/** True when `raw` is an origin the login window is allowed to navigate to. */
export function isLoginNavigationAllowed(
  policy: LoginPolicy,
  raw: string,
): boolean {
  const origin = originOf(raw);
  if (!origin) return false;
  return policy.navigateOrigins.includes(origin);
}
