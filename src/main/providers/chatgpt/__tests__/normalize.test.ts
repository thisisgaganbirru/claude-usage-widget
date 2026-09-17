import { describe, expect, it } from "vitest";
import { normalizeChatGptUsage, parseChatGptAccount } from "../normalize";
import { ProviderError } from "../../types";

const FETCHED_AT = "2026-03-10T00:00:00.000Z";
const options = {
  account: { accountLabel: "ada@example.com", plan: "Plus" },
  fetchedAt: FETCHED_AT,
};

describe("normalizeChatGptUsage", () => {
  it("reads a quota stated as limit and used", () => {
    const usage = normalizeChatGptUsage(
      {
        message_cap: { limit: 80, used: 20, reset_at: "2026-03-10T05:00:00Z" },
      },
      options,
    );

    expect(usage.providerId).toBe("chatgpt");
    expect(usage.accountLabel).toBe("ada@example.com");
    expect(usage.plan).toBe("Plus");
    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0].usedPercent).toBe(25);
    expect(usage.windows[0].resetsAt).toBe("2026-03-10T05:00:00.000Z");
  });

  it("derives the used count from a remaining count", () => {
    const usage = normalizeChatGptUsage(
      { quota: { limit: 40, remaining: 10 } },
      options,
    );

    expect(usage.windows[0].usedPercent).toBe(75);
  });

  it("derives the limit from remaining plus used", () => {
    const usage = normalizeChatGptUsage(
      { quota: { remaining: 25, used: 75 } },
      options,
    );

    expect(usage.windows[0].usedPercent).toBe(75);
  });

  it("leaves resetsAt null instead of inventing one", () => {
    const usage = normalizeChatGptUsage(
      { quota: { limit: 10, used: 1 } },
      options,
    );

    expect(usage.windows[0].resetsAt).toBeNull();
  });

  it("emits no weekly window when the vendor reports no weekly numbers", () => {
    const usage = normalizeChatGptUsage(
      { quota: { limit: 10, used: 1 } },
      options,
    );

    expect(usage.windows.some((window) => window.id === "weekly")).toBe(false);
  });

  it("emits a weekly window only from real weekly numbers", () => {
    const usage = normalizeChatGptUsage(
      {
        quota: {
          limit: 10,
          used: 1,
          weekly_limit: 200,
          weekly_used: 50,
          weekly_reset_at: "2026-03-16T00:00:00Z",
        },
      },
      options,
    );

    const weekly = usage.windows.find((window) => window.id === "weekly");
    expect(weekly?.usedPercent).toBe(25);
    expect(weekly?.resetsAt).toBe("2026-03-16T00:00:00.000Z");
  });

  it("picks the largest limit as the account-level window", () => {
    const usage = normalizeChatGptUsage(
      {
        feature: { limit: 5, used: 5 },
        account: { limit: 500, used: 50 },
      },
      options,
    );

    expect(usage.windows[0].usedPercent).toBe(10);
  });

  it("lists per-model quotas as model windows without repeating the total", () => {
    const usage = normalizeChatGptUsage(
      {
        account: { limit: 500, used: 50 },
        models: [
          { model: "gpt-5", limit: 100, used: 40 },
          { model: "gpt-5-mini", limit: 100, used: 10 },
        ],
      },
      options,
    );

    const models = usage.windows.filter((window) => window.model !== undefined);
    expect(models.map((window) => window.model).sort()).toEqual([
      "gpt-5",
      "gpt-5-mini",
    ]);
    expect(
      usage.windows.filter((window) => window.id === "session"),
    ).toHaveLength(1);
  });

  it("ignores an unparseable reset timestamp rather than failing the read", () => {
    const usage = normalizeChatGptUsage(
      { quota: { limit: 10, used: 1, reset_at: "soon" } },
      options,
    );

    expect(usage.windows[0].resetsAt).toBeNull();
  });

  it("raises a schema error when nothing quota-shaped is present", () => {
    expect(() => normalizeChatGptUsage({ hello: "world" }, options)).toThrow(
      ProviderError,
    );
    expect(() => normalizeChatGptUsage(null, options)).toThrow(ProviderError);
  });

  it("ignores a zero or negative limit", () => {
    expect(() =>
      normalizeChatGptUsage({ quota: { limit: 0, used: 0 } }, options),
    ).toThrow(ProviderError);
  });

  it("falls back to a fixed label when the account is unknown", () => {
    const usage = normalizeChatGptUsage(
      { quota: { limit: 10, used: 1 } },
      { account: { accountLabel: null, plan: null }, fetchedAt: FETCHED_AT },
    );

    expect(usage.accountLabel).toBe("ChatGPT account");
    expect(usage.plan).toBeNull();
  });
});

describe("parseChatGptAccount", () => {
  it("reads a name and a plan from a nested response", () => {
    expect(
      parseChatGptAccount({
        accounts: { default: { name: "Ada", plan: "pro" } },
      }),
    ).toEqual({ accountLabel: "Ada", plan: "pro" });
  });

  it("returns nulls rather than placeholder strings", () => {
    expect(parseChatGptAccount(null)).toEqual({
      accountLabel: null,
      plan: null,
    });
    expect(parseChatGptAccount({})).toEqual({
      accountLabel: null,
      plan: null,
    });
  });
});
