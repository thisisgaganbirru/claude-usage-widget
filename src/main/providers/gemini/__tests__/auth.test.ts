import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverGeminiCredentials,
  isUsable,
  parseActiveAccount,
  parseGeminiCredentials,
  parseScopes,
  REQUIRED_SCOPE,
} from "../auth";
import { accountsFile, credsFile, geminiHome } from "../paths";

const HOME = path.join(path.sep, "home", "ada");
const NOW = Date.parse("2026-09-17T12:00:00.000Z");

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

function creds(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    access_token: "ya29.token",
    refresh_token: "1//refresh",
    scope: `openid ${REQUIRED_SCOPE}`,
    token_type: "Bearer",
    expiry_date: NOW + 30 * 60 * 1000,
    ...overrides,
  };
}

describe("geminiHome", () => {
  it("honours GEMINI_DIR", () => {
    expect(geminiHome({ GEMINI_DIR: "/opt/gemini" }, HOME)).toBe("/opt/gemini");
  });

  it("falls back to ~/.gemini", () => {
    expect(credsFile({}, HOME)).toBe(
      path.join(HOME, ".gemini", "oauth_creds.json"),
    );
    expect(accountsFile({}, HOME)).toBe(
      path.join(HOME, ".gemini", "google_accounts.json"),
    );
  });
});

describe("parseScopes", () => {
  it("reads the space-separated form Google returns", () => {
    expect(parseScopes("openid email profile")).toEqual([
      "openid",
      "email",
      "profile",
    ]);
  });

  it("reads the array form too", () => {
    expect(parseScopes(["openid", 7, "email"])).toEqual(["openid", "email"]);
  });

  it("returns an empty list for anything else", () => {
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes("")).toEqual([]);
  });
});

describe("parseGeminiCredentials", () => {
  it("reads the stored credential", () => {
    expect(parseGeminiCredentials(creds())).toEqual({
      accessToken: "ya29.token",
      refreshToken: "1//refresh",
      expiryDate: NOW + 30 * 60 * 1000,
      scopes: ["openid", REQUIRED_SCOPE],
    });
  });

  it("tolerates a missing refresh token and expiry", () => {
    const parsed = parseGeminiCredentials({
      access_token: "ya29.token",
      scope: REQUIRED_SCOPE,
    });

    expect(parsed?.refreshToken).toBeNull();
    expect(parsed?.expiryDate).toBeNull();
  });

  it("returns null without an access token", () => {
    expect(parseGeminiCredentials({ scope: REQUIRED_SCOPE })).toBeNull();
    expect(parseGeminiCredentials(null)).toBeNull();
  });
});

describe("isUsable", () => {
  const base = {
    accessToken: "ya29.token",
    refreshToken: null,
    scopes: [REQUIRED_SCOPE],
  };

  it("accepts a token with time left on it", () => {
    expect(isUsable({ ...base, expiryDate: NOW + 3600_000 }, NOW)).toBe(true);
  });

  it("rejects a token inside the five-minute buffer", () => {
    expect(isUsable({ ...base, expiryDate: NOW + 60_000 }, NOW)).toBe(false);
  });

  it("rejects a token missing the Code Assist scope", () => {
    expect(
      isUsable(
        { ...base, scopes: ["openid"], expiryDate: NOW + 3600_000 },
        NOW,
      ),
    ).toBe(false);
  });

  it("takes a credential with no recorded expiry at face value", () => {
    expect(isUsable({ ...base, expiryDate: null }, NOW)).toBe(true);
  });
});

describe("parseActiveAccount", () => {
  it("reads the active email", () => {
    expect(parseActiveAccount({ active: "ada@example.com" })).toBe(
      "ada@example.com",
    );
  });

  it("returns null when there is none", () => {
    expect(parseActiveAccount({})).toBeNull();
    expect(parseActiveAccount("ada@example.com")).toBeNull();
  });
});

describe("discoverGeminiCredentials", () => {
  async function write(
    contents: Record<string, unknown>,
    accounts?: Record<string, unknown>,
  ): Promise<{ credsFile: string; accountsFile: string }> {
    const dir = await tempDir();
    const files = {
      credsFile: path.join(dir, "oauth_creds.json"),
      accountsFile: path.join(dir, "google_accounts.json"),
    };
    await fs.writeFile(files.credsFile, JSON.stringify(contents), "utf8");
    if (accounts !== undefined) {
      await fs.writeFile(files.accountsFile, JSON.stringify(accounts), "utf8");
    }
    return files;
  }

  it("reads the credential and the account label", async () => {
    const files = await write(creds(), { active: "ada@example.com" });

    const found = await discoverGeminiCredentials({ ...files, now: NOW });

    expect(found?.credentials.accessToken).toBe("ya29.token");
    expect(found?.email).toBe("ada@example.com");
    expect(found?.source).toBe(files.credsFile);
  });

  it("works without the account file, which is only a label", async () => {
    const files = await write(creds());

    const found = await discoverGeminiCredentials({ ...files, now: NOW });

    expect(found?.email).toBeNull();
  });

  it("returns null when the CLI has not signed in here", async () => {
    const dir = await tempDir();

    expect(
      await discoverGeminiCredentials({
        credsFile: path.join(dir, "oauth_creds.json"),
        accountsFile: path.join(dir, "google_accounts.json"),
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null for a half-written credentials file", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "oauth_creds.json");
    await fs.writeFile(file, "{ truncated", "utf8");

    expect(
      await discoverGeminiCredentials({
        credsFile: file,
        accountsFile: path.join(dir, "google_accounts.json"),
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns the expired credential as it stands when nothing can renew it", async () => {
    const files = await write(creds({ expiry_date: NOW - 60_000 }));

    const found = await discoverGeminiCredentials({ ...files, now: NOW });

    expect(found?.credentials.accessToken).toBe("ya29.token");
    expect(isUsable(found!.credentials, NOW)).toBe(false);
  });

  it("uses a refresher when one is supplied and the token has aged out", async () => {
    const files = await write(creds({ expiry_date: NOW - 60_000 }));
    const refresh = vi.fn().mockResolvedValue({
      accessToken: "ya29.fresh",
      expiryDate: NOW + 3600_000,
    });

    const found = await discoverGeminiCredentials({
      ...files,
      refresh,
      now: NOW,
    });

    expect(refresh).toHaveBeenCalledWith("1//refresh");
    expect(found?.credentials.accessToken).toBe("ya29.fresh");
    expect(isUsable(found!.credentials, NOW)).toBe(true);
  });

  it("keeps the stored credential when the refresh fails", async () => {
    const files = await write(creds({ expiry_date: NOW - 60_000 }));
    const refresh = vi.fn().mockRejectedValue(new Error("invalid_grant"));

    const found = await discoverGeminiCredentials({
      ...files,
      refresh,
      now: NOW,
    });

    expect(found?.credentials.accessToken).toBe("ya29.token");
  });

  it("does not spend a refresh on a token that is still good", async () => {
    const files = await write(creds());
    const refresh = vi.fn();

    await discoverGeminiCredentials({ ...files, refresh, now: NOW });

    expect(refresh).not.toHaveBeenCalled();
  });
});
