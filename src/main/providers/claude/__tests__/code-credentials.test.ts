import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claudeConfigDir,
  credentialsFileCandidates,
  decodeKeychainPayload,
  discoverClaudeCodeCredentials,
  isUsable,
  parseClaudeCodeCredentials,
  REFRESH_BUFFER_MS,
} from "../code-credentials";

const NOW = Date.parse("2026-03-10T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const HOME = path.join(path.sep, "home", "ada");

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-code-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

function credentialsJson(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    claudeAiOauth: {
      accessToken: "sk-ant-oat-test",
      refreshToken: "sk-ant-ort-test",
      expiresAt: NOW + HOUR_MS,
      scopes: ["user:inference", "user:profile"],
      subscriptionType: "max",
      rateLimitTier: "default_claude_max_20x",
      ...overrides,
    },
  };
}

/** A config directory holding a credentials file, ready to discover from. */
async function claudeHome(json: unknown): Promise<string> {
  const dir = await tempDir();
  await fs.mkdir(path.join(dir, ".claude"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".claude", ".credentials.json"),
    JSON.stringify(json),
    "utf8",
  );
  return dir;
}

describe("claudeConfigDir", () => {
  it("defaults to ~/.claude", () => {
    expect(claudeConfigDir({}, HOME)).toBe(path.join(HOME, ".claude"));
  });

  it("honours CLAUDE_CONFIG_DIR", () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: "/work/cc" }, HOME)).toBe(
      "/work/cc",
    );
  });
});

describe("credentialsFileCandidates", () => {
  it("checks the secure-storage override before the config root", () => {
    expect(
      credentialsFileCandidates(
        { CLAUDE_SECURESTORAGE_CONFIG_DIR: "/secure" },
        HOME,
      ),
    ).toEqual([
      path.join("/secure", ".credentials.json"),
      path.join(HOME, ".claude", ".credentials.json"),
    ]);
  });

  it("uses the config root alone when there is no override", () => {
    expect(credentialsFileCandidates({}, HOME)).toEqual([
      path.join(HOME, ".claude", ".credentials.json"),
    ]);
  });
});

describe("parseClaudeCodeCredentials", () => {
  it("reads the claudeAiOauth block", () => {
    expect(parseClaudeCodeCredentials(credentialsJson())).toEqual({
      accessToken: "sk-ant-oat-test",
      refreshToken: "sk-ant-ort-test",
      expiresAt: NOW + HOUR_MS,
      scopes: ["user:inference", "user:profile"],
      subscriptionType: "max",
      rateLimitTier: "default_claude_max_20x",
    });
  });

  it("returns null for a store that holds no Claude login", () => {
    expect(parseClaudeCodeCredentials({ mcpOAuth: {} })).toBeNull();
    expect(parseClaudeCodeCredentials({})).toBeNull();
    expect(parseClaudeCodeCredentials(null)).toBeNull();
  });

  it("returns null when there is no access token to use", () => {
    expect(
      parseClaudeCodeCredentials(credentialsJson({ accessToken: "" })),
    ).toBeNull();
  });

  it("treats a missing expiry as open-ended rather than expired", () => {
    const parsed = parseClaudeCodeCredentials(
      credentialsJson({ expiresAt: undefined }),
    );

    expect(parsed?.expiresAt).toBeNull();
  });
});

describe("isUsable", () => {
  const base = parseClaudeCodeCredentials(credentialsJson());

  it("accepts a token with time left on it", () => {
    expect(isUsable(base!, NOW)).toBe(true);
  });

  it("refuses a token inside the refresh buffer", () => {
    const soon = parseClaudeCodeCredentials(
      credentialsJson({ expiresAt: NOW + REFRESH_BUFFER_MS - 1000 }),
    );

    expect(isUsable(soon!, NOW)).toBe(false);
  });

  it("refuses an inference-only token, which cannot read usage", () => {
    const inferenceOnly = parseClaudeCodeCredentials(
      credentialsJson({ scopes: ["user:inference"] }),
    );

    expect(isUsable(inferenceOnly!, NOW)).toBe(false);
  });

  it("allows a store that lists no scopes at all", () => {
    const noScopes = parseClaudeCodeCredentials(
      credentialsJson({ scopes: undefined }),
    );

    expect(isUsable(noScopes!, NOW)).toBe(true);
  });
});

describe("decodeKeychainPayload", () => {
  it("decodes the hex form macOS returns for a non-ASCII password", () => {
    const json = '{"claudeAiOauth":{}}';
    const hex = Buffer.from(json, "utf8").toString("hex");

    expect(decodeKeychainPayload(hex)).toBe(json);
  });

  it("leaves plain JSON alone", () => {
    expect(decodeKeychainPayload(' {"a":1} ')).toBe('{"a":1}');
  });
});

describe("discoverClaudeCodeCredentials", () => {
  it("reads the credentials file first", async () => {
    const home = await claudeHome(credentialsJson());

    const found = await discoverClaudeCodeCredentials({
      env: {},
      homeDir: home,
      platform: "linux",
      now: NOW,
    });

    expect(found?.source).toBe("file");
    expect(found?.credentials.accessToken).toBe("sk-ant-oat-test");
  });

  it("falls through to the keychain on macOS", async () => {
    const home = await tempDir();

    const found = await discoverClaudeCodeCredentials({
      env: {},
      homeDir: home,
      platform: "darwin",
      now: NOW,
      readKeychain: async () => JSON.stringify(credentialsJson()),
    });

    expect(found?.source).toBe("keychain");
  });

  it("does not reach for the keychain off macOS", async () => {
    const home = await tempDir();
    let asked = false;

    const found = await discoverClaudeCodeCredentials({
      env: {},
      homeDir: home,
      platform: "win32",
      now: NOW,
      readKeychain: async () => {
        asked = true;
        return JSON.stringify(credentialsJson());
      },
    });

    expect(asked).toBe(false);
    expect(found).toBeNull();
  });

  it("uses the env token only once nothing else answered", async () => {
    const home = await tempDir();

    const found = await discoverClaudeCodeCredentials({
      env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-env" },
      homeDir: home,
      platform: "linux",
      now: NOW,
    });

    expect(found?.source).toBe("env");
    expect(found?.credentials.accessToken).toBe("sk-ant-oat-env");
  });

  it("prefers the signed-in file over the env token", async () => {
    const home = await claudeHome(credentialsJson());

    const found = await discoverClaudeCodeCredentials({
      env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-env" },
      homeDir: home,
      platform: "linux",
      now: NOW,
    });

    expect(found?.source).toBe("file");
  });

  it("skips an expired file and keeps looking", async () => {
    const home = await claudeHome(
      credentialsJson({ expiresAt: NOW - HOUR_MS }),
    );

    const found = await discoverClaudeCodeCredentials({
      env: {},
      homeDir: home,
      platform: "darwin",
      now: NOW,
      readKeychain: async () => JSON.stringify(credentialsJson()),
    });

    expect(found?.source).toBe("keychain");
  });

  it("steps over a half-written file", async () => {
    const home = await tempDir();
    await fs.mkdir(path.join(home, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(home, ".claude", ".credentials.json"),
      "{ truncated",
      "utf8",
    );

    const found = await discoverClaudeCodeCredentials({
      env: {},
      homeDir: home,
      platform: "linux",
      now: NOW,
    });

    expect(found).toBeNull();
  });

  it("returns null when Claude Code is not on the machine", async () => {
    const home = await tempDir();

    expect(
      await discoverClaudeCodeCredentials({
        env: {},
        homeDir: home,
        platform: "linux",
        now: NOW,
      }),
    ).toBeNull();
  });
});
