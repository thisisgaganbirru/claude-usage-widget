import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAppsFile, readCopilotToken } from "../auth";
import { appsFileCandidates } from "../paths";
import { usageUrlFor } from "..";

const HOME = path.join(path.sep, "home", "octocat");

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("appsFileCandidates", () => {
  it("uses ~/.config on macOS and Linux", () => {
    expect(
      appsFileCandidates({ env: {}, homeDir: HOME, platform: "darwin" }),
    ).toEqual([path.join(HOME, ".config", "github-copilot", "apps.json")]);
  });

  it("prefers LOCALAPPDATA on Windows", () => {
    const candidates = appsFileCandidates({
      env: { LOCALAPPDATA: "C:\\Users\\octocat\\AppData\\Local" },
      homeDir: HOME,
      platform: "win32",
    });

    expect(candidates[0]).toBe(
      path.join(
        "C:\\Users\\octocat\\AppData\\Local",
        "github-copilot",
        "apps.json",
      ),
    );
    expect(candidates).toHaveLength(3);
  });
});

describe("parseAppsFile", () => {
  it("reads the token out of a client-id keyed entry", () => {
    expect(
      parseAppsFile({
        "github.com:Iv1.b507a08c87ecfe98": {
          user: "octocat",
          oauth_token: "gho_test",
          githubAppId: "Iv1.b507a08c87ecfe98",
        },
      }),
    ).toEqual({ token: "gho_test", user: "octocat", host: "github.com" });
  });

  it("prefers github.com over an enterprise host", () => {
    const parsed = parseAppsFile({
      "github.acme.com:Iv1.a": { user: "ada", oauth_token: "gho_enterprise" },
      "github.com:Iv1.b": { user: "octocat", oauth_token: "gho_public" },
    });

    expect(parsed?.token).toBe("gho_public");
  });

  it("takes an enterprise entry when it is the only one", () => {
    const parsed = parseAppsFile({
      "github.acme.com:Iv1.a": { user: "ada", oauth_token: "gho_enterprise" },
    });

    expect(parsed?.host).toBe("github.acme.com");
  });

  it("returns null when no entry carries a token", () => {
    expect(
      parseAppsFile({ "github.com:Iv1.a": { user: "octocat" } }),
    ).toBeNull();
    expect(parseAppsFile({})).toBeNull();
    expect(parseAppsFile(null)).toBeNull();
  });
});

describe("usageUrlFor", () => {
  it("uses api.github.com for github.com", () => {
    expect(usageUrlFor("github.com")).toBe(
      "https://api.github.com/copilot_internal/user",
    );
  });

  it("prefixes an enterprise host", () => {
    expect(usageUrlFor("github.acme.com")).toBe(
      "https://api.github.acme.com/copilot_internal/user",
    );
  });
});

describe("readCopilotToken", () => {
  it("reads the first candidate that carries a token", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "apps.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        "github.com:Iv1.a": { user: "octocat", oauth_token: "gho_test" },
      }),
      "utf8",
    );

    const found = await readCopilotToken([
      path.join(dir, "missing.json"),
      file,
    ]);

    expect(found?.token).toBe("gho_test");
  });

  it("returns null when Copilot is not signed in on this machine", async () => {
    const dir = await tempDir();
    expect(await readCopilotToken([path.join(dir, "apps.json")])).toBeNull();
  });

  it("steps over a half-written file", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "apps.json");
    await fs.writeFile(file, "{ truncated", "utf8");

    expect(await readCopilotToken([file])).toBeNull();
  });
});
