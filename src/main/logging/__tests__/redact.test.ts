import { describe, expect, it } from "vitest";

import {
  CIRCULAR,
  MAX_ARRAY_LENGTH,
  REDACTED,
  TRUNCATED,
  redactError,
  redactFields,
  redactText,
  redactValue,
} from "../redact";

/**
 * Invented, non-functional credentials that merely match the shapes we guard
 * against. None of these is a real secret.
 */
const FAKE = {
  anthropicApiKey: "sk-ant-api03-AbCdEfGh1234567890IjKlMnOpQrStUvWxYz",
  anthropicSessionId: "sk-ant-sid01-0123456789abcdefghijklmnopqrst",
  openAiProjectKey: "sk-proj-aBcD1234EfGh5678IjKl9012MnOpQrSt",
  openAiLegacyKey: "sk-1234567890abcdefghijklmnopqrstuv",
  githubToken: "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
  googleAccessToken: "ya29.a0ARrdaMnotarealtokenvalue1234567890",
  googleRefreshToken: "1//0gNotARealRefreshTokenValue123",
  jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.QwErTyUiOp1234567890AsDfGhJkLz",
};

describe("redactText credential shapes", () => {
  it("masks Anthropic api keys and session ids", () => {
    expect(redactText(`key=${FAKE.anthropicApiKey}`)).not.toContain("sk-ant-");
    expect(redactText(`value ${FAKE.anthropicSessionId} here`)).toBe(
      `value ${REDACTED} here`,
    );
  });

  it("masks OpenAI-style keys", () => {
    expect(redactText(`using ${FAKE.openAiProjectKey}`)).toBe(
      `using ${REDACTED}`,
    );
    expect(redactText(`using ${FAKE.openAiLegacyKey}`)).toBe(
      `using ${REDACTED}`,
    );
  });

  it("leaves short sk- lookalikes alone", () => {
    expect(redactText("sk-short")).toBe("sk-short");
  });

  it("masks GitHub tokens", () => {
    expect(redactText(`token ${FAKE.githubToken}`)).toBe(`token ${REDACTED}`);
  });

  it("masks Google OAuth access and refresh tokens", () => {
    expect(redactText(`access ${FAKE.googleAccessToken}`)).toBe(
      `access ${REDACTED}`,
    );
    expect(redactText(`refresh ${FAKE.googleRefreshToken}`)).toBe(
      `refresh ${REDACTED}`,
    );
  });

  it("masks JWTs", () => {
    expect(redactText(`jwt ${FAKE.jwt}`)).toBe(`jwt ${REDACTED}`);
  });

  it("masks bearer tokens but keeps the scheme", () => {
    expect(redactText(`Authorization: Bearer ${FAKE.jwt}`)).toBe(
      `Authorization: Bearer ${REDACTED}`,
    );
    expect(redactText("authorization: bearer abcdef")).toBe(
      `authorization: Bearer ${REDACTED}`,
    );
  });

  it("masks known session cookie values while keeping the cookie name", () => {
    const names = [
      "sessionKey",
      "sessionKeyV2",
      "CH_SESSION",
      "__Secure-next-auth.session-token",
      "next-auth.session-token",
      "__Secure-authjs.session-token",
      "authjs.session-token",
      "WorkosCursorSessionToken",
    ];
    for (const name of names) {
      expect(redactText(`${name}=abc123def456`)).toBe(`${name}=${REDACTED}`);
    }
  });

  it("masks Cookie and Set-Cookie header lines, keeping attributes", () => {
    expect(
      redactText(
        "Set-Cookie: __Secure-authjs.session-token=abc123; Path=/; HttpOnly",
      ),
    ).toBe(
      `Set-Cookie: __Secure-authjs.session-token=${REDACTED}; Path=/; HttpOnly`,
    );
    expect(redactText("Cookie: a=1; sessionKey=deadbeef")).toBe(
      `Cookie: a=${REDACTED}; sessionKey=${REDACTED}`,
    );
  });

  it("masks any generic pair whose name hints at a credential", () => {
    expect(redactText("refreshToken=abc123")).toBe(`refreshToken=${REDACTED}`);
    expect(redactText("api_key=abc123")).toBe(`api_key=${REDACTED}`);
    expect(redactText("page=3")).toBe("page=3");
  });

  it("masks JSON-ish credential pairs", () => {
    expect(redactText('{"accessToken": "abc123", "count": 3}')).toBe(
      `{"accessToken": "${REDACTED}", "count": 3}`,
    );
  });
});

describe("redactText URLs", () => {
  it("reduces a URL to origin and pathname, dropping query and fragment", () => {
    expect(
      redactText("GET https://api.example.com/v1/usage?sessionKey=abc#frag"),
    ).toBe("GET https://api.example.com/v1/usage");
  });

  it("drops userinfo embedded in the URL", () => {
    expect(redactText("https://user:hunter2@example.com/a")).toBe(
      "https://example.com/a",
    );
  });

  it("keeps trailing sentence punctuation outside the URL", () => {
    expect(redactText("see https://example.com/docs?x=1.")).toBe(
      "see https://example.com/docs.",
    );
  });

  it("still masks a credential embedded in a URL path", () => {
    expect(redactText(`https://example.com/cb/${FAKE.anthropicApiKey}`)).toBe(
      `https://example.com/cb/${REDACTED}`,
    );
  });
});

describe("redactText idempotency", () => {
  const sample = [
    `Authorization: Bearer ${FAKE.jwt}`,
    `Cookie: sessionKey=${FAKE.anthropicSessionId}; Path=/`,
    `GET https://api.example.com/v1/usage?apiKey=${FAKE.openAiLegacyKey}#f`,
    `github ${FAKE.githubToken} google ${FAKE.googleAccessToken}`,
    `refresh ${FAKE.googleRefreshToken} project ${FAKE.openAiProjectKey}`,
    `anthropic ${FAKE.anthropicApiKey}`,
    '{"password": "hunter2"}',
  ].join("\n");

  it("is stable under repeated application", () => {
    const once = redactText(sample);
    expect(redactText(once)).toBe(once);
    expect(redactText(redactText(once))).toBe(once);
  });

  it("leaves no credential material behind", () => {
    const once = redactText(sample);
    expect(once).not.toContain("sk-ant-");
    expect(once).not.toContain("ghp_");
    expect(once).not.toContain("ya29.");
    expect(once).not.toContain("eyJ");
    expect(once).not.toContain("hunter2");
  });
});

describe("redactValue", () => {
  it("leaves numbers, booleans and null as-is", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBeNull();
    expect(redactValue(undefined)).toBeUndefined();
  });

  it("redacts strings inside nested objects and arrays", () => {
    expect(
      redactValue({ items: [{ note: `token ${FAKE.githubToken}` }] }),
    ).toEqual({ items: [{ note: `token ${REDACTED}` }] });
  });

  it("caps array length", () => {
    const long = Array.from({ length: MAX_ARRAY_LENGTH + 10 }, (_v, i) => i);
    const result = redactValue(long) as unknown[];
    expect(result).toHaveLength(MAX_ARRAY_LENGTH + 1);
    expect(result[MAX_ARRAY_LENGTH]).toBe("[+10 more]");
  });

  it("caps depth", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: "deep" } } } } } } };
    const json = JSON.stringify(redactValue(deep));
    expect(json).toContain(TRUNCATED);
    expect(json).not.toContain("deep");
  });

  it("handles cycles without throwing", () => {
    const node: Record<string, unknown> = { name: "root" };
    node.self = node;
    const result = redactValue(node) as Record<string, unknown>;
    expect(result.name).toBe("root");
    expect(result.self).toBe(CIRCULAR);
  });

  it("converts an Error to a plain redacted object", () => {
    const error = new Error(`failed with ${FAKE.anthropicApiKey}`);
    const result = redactValue(error) as Record<string, unknown>;
    expect(result.name).toBe("Error");
    expect(result.message).toBe(`failed with ${REDACTED}`);
    expect(typeof result.stack).toBe("string");
    expect(result.stack).not.toContain("sk-ant-");
  });

  it("flattens errors through redactError too", () => {
    const flat = redactError(new Error(`bad ${FAKE.jwt}`));
    expect(flat.message).toBe(`bad ${REDACTED}`);
  });
});

describe("redactFields", () => {
  it("replaces values by key name even when they look innocuous", () => {
    expect(
      redactFields({
        apiKey: "harmless",
        cookie: "a=1",
        password: "x",
        sessionId: "1",
        authorization: "none",
        credentials: "n/a",
        mySecret: "n/a",
        accessToken: "n/a",
        count: 3,
      }),
    ).toEqual({
      apiKey: REDACTED,
      cookie: REDACTED,
      password: REDACTED,
      sessionId: REDACTED,
      authorization: REDACTED,
      credentials: REDACTED,
      mySecret: REDACTED,
      accessToken: REDACTED,
      count: 3,
    });
  });

  it("applies key-name redaction to nested objects as well", () => {
    expect(redactFields({ meta: { token: "abc", page: 2 } })).toEqual({
      meta: { token: REDACTED, page: 2 },
    });
  });

  it("still redacts values of innocuously named keys", () => {
    expect(redactFields({ note: `see ${FAKE.githubToken}` })).toEqual({
      note: `see ${REDACTED}`,
    });
  });

  it("survives a cyclic field value", () => {
    const node: Record<string, unknown> = { label: "n" };
    node.parent = node;
    expect(() => redactFields({ node })).not.toThrow();
  });
});
