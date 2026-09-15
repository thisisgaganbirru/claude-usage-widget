import { describe, expect, it } from "vitest";
import {
  getLoginPolicy,
  isLoginNavigationAllowed,
  isPostLoginUrl,
  isVendorCookieDomain,
  listVendorPartitions,
} from "@main/auth/login-policy";

const claude = getLoginPolicy("claude");
const chatgpt = getLoginPolicy("chatgpt");

describe("vendor partitions", () => {
  it("gives each vendor its own persistent partition", () => {
    expect(claude.partition).toBe("persist:vendor-claude");
    expect(chatgpt.partition).toBe("persist:vendor-chatgpt");
  });

  it("never shares a partition between vendors", () => {
    const partitions = listVendorPartitions();
    expect(new Set(partitions).size).toBe(partitions.length);
  });

  it("keeps every partition persistent, so sign-in survives a restart", () => {
    for (const partition of listVendorPartitions()) {
      expect(partition.startsWith("persist:")).toBe(true);
    }
  });
});

describe("isPostLoginUrl", () => {
  it("accepts the app shell the user lands on after signing in", () => {
    expect(isPostLoginUrl(claude, "https://claude.ai/")).toBe(true);
    expect(isPostLoginUrl(claude, "https://claude.ai/chat/abc-123")).toBe(true);
    expect(isPostLoginUrl(chatgpt, "https://chatgpt.com/")).toBe(true);
  });

  it("rejects the login and auth paths themselves", () => {
    expect(isPostLoginUrl(claude, "https://claude.ai/login")).toBe(false);
    expect(isPostLoginUrl(claude, "https://claude.ai/login?return=/")).toBe(
      false,
    );
    expect(isPostLoginUrl(claude, "https://claude.ai/login/sso")).toBe(false);
    expect(isPostLoginUrl(claude, "https://claude.ai/auth/signin")).toBe(false);
    expect(isPostLoginUrl(claude, "https://claude.ai/magic-link/abc")).toBe(
      false,
    );
    expect(isPostLoginUrl(chatgpt, "https://chatgpt.com/auth/login")).toBe(
      false,
    );
    expect(
      isPostLoginUrl(chatgpt, "https://chatgpt.com/api/auth/session"),
    ).toBe(false);
  });

  it("matches auth paths on segment boundaries, not as prefixes", () => {
    expect(isPostLoginUrl(claude, "https://claude.ai/logins-explained")).toBe(
      true,
    );
    expect(isPostLoginUrl(claude, "https://claude.ai/authors")).toBe(true);
  });

  it("rejects a lookalike host that a prefix test would accept", () => {
    expect(isPostLoginUrl(claude, "https://claude.ai.evil.example/")).toBe(
      false,
    );
    expect(isPostLoginUrl(claude, "https://claude.ai@evil.example/")).toBe(
      false,
    );
    expect(
      isPostLoginUrl(claude, "https://evil.example/https://claude.ai/"),
    ).toBe(false);
  });

  it("rejects the same path over a plaintext scheme", () => {
    expect(isPostLoginUrl(claude, "http://claude.ai/chat/abc")).toBe(false);
  });

  it("never treats an identity provider as post-login", () => {
    expect(
      isPostLoginUrl(claude, "https://accounts.google.com/o/oauth2/v2/auth"),
    ).toBe(false);
    expect(isPostLoginUrl(chatgpt, "https://auth.openai.com/authorize")).toBe(
      false,
    );
  });

  it("rejects the other vendor's app shell", () => {
    expect(isPostLoginUrl(claude, "https://chatgpt.com/")).toBe(false);
    expect(isPostLoginUrl(chatgpt, "https://claude.ai/")).toBe(false);
  });

  it("rejects garbage instead of throwing", () => {
    expect(isPostLoginUrl(claude, "")).toBe(false);
    expect(isPostLoginUrl(claude, "not a url")).toBe(false);
    expect(isPostLoginUrl(claude, "about:blank")).toBe(false);
  });
});

describe("isVendorCookieDomain", () => {
  it("accepts the vendor host and its subdomains", () => {
    expect(isVendorCookieDomain(claude, "claude.ai")).toBe(true);
    expect(isVendorCookieDomain(claude, ".claude.ai")).toBe(true);
    expect(isVendorCookieDomain(claude, "www.claude.ai")).toBe(true);
    expect(isVendorCookieDomain(chatgpt, ".openai.com")).toBe(true);
  });

  it("rejects a host that merely ends with the vendor name", () => {
    expect(isVendorCookieDomain(claude, "notclaude.ai")).toBe(false);
    expect(isVendorCookieDomain(claude, "claude.ai.evil.example")).toBe(false);
    expect(isVendorCookieDomain(claude, "evil-claude.ai")).toBe(false);
  });

  it("rejects the other vendor's cookies", () => {
    expect(isVendorCookieDomain(claude, "chatgpt.com")).toBe(false);
    expect(isVendorCookieDomain(chatgpt, "claude.ai")).toBe(false);
  });

  it("rejects an empty or missing domain", () => {
    expect(isVendorCookieDomain(claude, undefined)).toBe(false);
    expect(isVendorCookieDomain(claude, "")).toBe(false);
    expect(isVendorCookieDomain(claude, ".")).toBe(false);
  });
});

describe("isLoginNavigationAllowed", () => {
  it("allows the vendor and the identity providers it offers", () => {
    expect(isLoginNavigationAllowed(claude, "https://claude.ai/login")).toBe(
      true,
    );
    expect(
      isLoginNavigationAllowed(claude, "https://accounts.google.com/signin"),
    ).toBe(true);
    expect(
      isLoginNavigationAllowed(chatgpt, "https://auth.openai.com/authorize"),
    ).toBe(true);
  });

  it("allows the bot challenge both login pages embed", () => {
    expect(
      isLoginNavigationAllowed(
        claude,
        "https://challenges.cloudflare.com/turnstile/v0/api.js",
      ),
    ).toBe(true);
  });

  it("blocks everything else, including the other vendor", () => {
    expect(isLoginNavigationAllowed(claude, "https://evil.example/")).toBe(
      false,
    );
    expect(isLoginNavigationAllowed(claude, "https://chatgpt.com/")).toBe(
      false,
    );
    expect(isLoginNavigationAllowed(claude, "file:///etc/passwd")).toBe(false);
    expect(isLoginNavigationAllowed(claude, "http://claude.ai/login")).toBe(
      false,
    );
  });

  it("never allows a popup from an origin it would not navigate to", () => {
    for (const policy of [claude, chatgpt]) {
      for (const origin of policy.popupOrigins) {
        expect(policy.navigateOrigins).toContain(origin);
      }
    }
  });

  it("keeps popups to identity providers only, never the vendor itself", () => {
    expect(claude.popupOrigins).not.toContain(claude.appOrigin);
    expect(chatgpt.popupOrigins).not.toContain(chatgpt.appOrigin);
  });
});
