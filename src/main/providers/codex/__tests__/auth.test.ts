import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCodexAccount, readCodexAccount } from "../auth";

function jwt(claims: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${body}.not-a-real-signature`;
}

function authFile(claims: unknown): unknown {
  return {
    OPENAI_API_KEY: null,
    tokens: {
      id_token: jwt(claims),
      access_token: "secret-access-token",
      refresh_token: "secret-refresh-token",
    },
  };
}

const CLAIMS = {
  "https://api.openai.com/profile": { email: "ada@example.com" },
  "https://api.openai.com/auth": { chatgpt_plan_type: "pro" },
};

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-auth-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("parseCodexAccount", () => {
  it("reads the email and plan out of the ID token", () => {
    expect(parseCodexAccount(authFile(CLAIMS))).toEqual({
      email: "ada@example.com",
      planType: "pro",
    });
  });

  it("returns an empty account for a file with no ID token", () => {
    expect(parseCodexAccount({ tokens: { access_token: "x" } })).toEqual({
      email: null,
      planType: null,
    });
    expect(parseCodexAccount(null)).toEqual({ email: null, planType: null });
  });

  it("survives claims that carry neither group", () => {
    expect(parseCodexAccount(authFile({ sub: "user_1" }))).toEqual({
      email: null,
      planType: null,
    });
  });

  it("caps a label the vendor made long", () => {
    const account = parseCodexAccount(
      authFile({
        "https://api.openai.com/profile": { email: "a".repeat(200) },
      }),
    );

    expect(account.email).toHaveLength(64);
  });
});

describe("readCodexAccount", () => {
  it("reads the first candidate that exists", async () => {
    const dir = await tempDir();
    const second = path.join(dir, "second.json");
    await fs.writeFile(second, JSON.stringify(authFile(CLAIMS)), "utf8");

    const found = await readCodexAccount([
      path.join(dir, "missing.json"),
      second,
    ]);

    expect(found?.file).toBe(second);
    expect(found?.account.email).toBe("ada@example.com");
  });

  it("returns null when no candidate exists", async () => {
    const dir = await tempDir();
    expect(await readCodexAccount([path.join(dir, "missing.json")])).toBeNull();
  });

  it("costs a label, not the read, when the file is malformed", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "auth.json");
    await fs.writeFile(file, "{ not json", "utf8");

    const found = await readCodexAccount([file]);

    expect(found).toEqual({ account: { email: null, planType: null }, file });
  });
});
