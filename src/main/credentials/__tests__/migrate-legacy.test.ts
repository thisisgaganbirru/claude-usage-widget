import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCredentialStore,
  type CredentialStore,
  type SecureBackend,
} from "../credential-store";
import {
  LEGACY_INSTALL_ID_FILE,
  credentialIdForLegacyFile,
  migrateLegacyCredentials,
} from "../migrate-legacy";

const PREFIX = "fake:";

/** Reversible stand-in for safeStorage; enough to prove the round trip. */
function createFakeBackend(): SecureBackend {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (plain: string) =>
      Buffer.from(`${PREFIX}${Buffer.from(plain, "utf8").toString("base64")}`),
    decryptString: (data: Buffer) => {
      const text = data.toString("utf8");
      if (!text.startsWith(PREFIX)) throw new Error("fake: bad ciphertext");
      return Buffer.from(text.slice(PREFIX.length), "base64").toString("utf8");
    },
  };
}

let userDataDir: string;
let store: CredentialStore;

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cred-migrate-"));
  store = createCredentialStore({
    backend: createFakeBackend(),
    baseDir: path.join(userDataDir, "credentials"),
    platform: "linux",
  });
});

afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

function writeLegacyFile(name: string, body = "legacy-ciphertext"): string {
  const filePath = path.join(userDataDir, name);
  fs.writeFileSync(filePath, body);
  return filePath;
}

function writeInstallId(): void {
  fs.writeFileSync(
    path.join(userDataDir, LEGACY_INSTALL_ID_FILE),
    JSON.stringify({ installId: "00000000-0000-4000-8000-000000000000" }),
  );
}

function installIdExists(): boolean {
  return fs.existsSync(path.join(userDataDir, LEGACY_INSTALL_ID_FILE));
}

describe("credentialIdForLegacyFile", () => {
  it("maps a legacy file name to a provider-scoped credential id", () => {
    expect(credentialIdForLegacyFile("auth-session-claude-default.json")).toBe(
      "claude-default",
    );
    expect(
      credentialIdForLegacyFile("auth-session-chatgpt-chatgpt-ab12cd.json"),
    ).toBe("chatgpt-chatgpt-ab12cd");
  });

  it("ignores unrelated files", () => {
    expect(credentialIdForLegacyFile("auth-accounts.json")).toBeNull();
    expect(credentialIdForLegacyFile("settings.json")).toBeNull();
    expect(credentialIdForLegacyFile("auth-session-.json")).toBeNull();
  });
});

describe("migrateLegacyCredentials", () => {
  it("migrates every legacy session and drops the install id", () => {
    writeLegacyFile("auth-session-claude-default.json");
    writeLegacyFile("auth-session-chatgpt-acct2.json");
    writeInstallId();
    fs.writeFileSync(path.join(userDataDir, "settings.json"), "{}");

    const result = migrateLegacyCredentials({
      store,
      userDataDir,
      readLegacySession: (filePath) => `cookie-for-${path.basename(filePath)}`,
    });

    expect(result.migrated).toEqual(["chatgpt-acct2", "claude-default"]);
    expect(result.skipped).toEqual([]);
    expect(result.removed).toEqual([
      "auth-session-chatgpt-acct2.json",
      "auth-session-claude-default.json",
      LEGACY_INSTALL_ID_FILE,
    ]);

    expect(store.list()).toEqual(["chatgpt-acct2", "claude-default"]);
    expect(store.read("claude-default")).toBe(
      "cookie-for-auth-session-claude-default.json",
    );
    expect(
      fs.existsSync(path.join(userDataDir, "auth-session-claude-default.json")),
    ).toBe(false);
    expect(installIdExists()).toBe(false);
    // Unrelated files are untouched.
    expect(fs.existsSync(path.join(userDataDir, "settings.json"))).toBe(true);
  });

  it("skips a legacy file that cannot be decrypted and keeps it on disk", () => {
    writeLegacyFile("auth-session-claude-default.json");
    writeLegacyFile("auth-session-claude-broken.json");
    writeInstallId();

    const result = migrateLegacyCredentials({
      store,
      userDataDir,
      readLegacySession: (filePath) =>
        filePath.includes("broken") ? null : "good-cookie",
    });

    expect(result.migrated).toEqual(["claude-default"]);
    expect(result.removed).toEqual(["auth-session-claude-default.json"]);
    expect(result.skipped).toEqual(["auth-session-claude-broken.json"]);

    expect(
      fs.existsSync(path.join(userDataDir, "auth-session-claude-broken.json")),
    ).toBe(true);
    // The key for the remaining file must survive.
    expect(installIdExists()).toBe(true);
    expect(store.read("claude-default")).toBe("good-cookie");
  });

  it("skips when the reader throws, instead of propagating", () => {
    writeLegacyFile("auth-session-claude-default.json");
    writeInstallId();

    const result = migrateLegacyCredentials({
      store,
      userDataDir,
      readLegacySession: () => {
        throw new Error("electron-store exploded");
      },
    });

    expect(result).toEqual({
      migrated: [],
      removed: [],
      skipped: ["auth-session-claude-default.json"],
    });
    expect(installIdExists()).toBe(true);
  });

  it("skips when the new store refuses to save", () => {
    writeLegacyFile("auth-session-claude-default.json");
    writeInstallId();
    const refusingStore = createCredentialStore({
      backend: {
        ...createFakeBackend(),
        getSelectedStorageBackend: () => "basic_text",
      },
      baseDir: path.join(userDataDir, "credentials"),
      platform: "linux",
    });

    const result = migrateLegacyCredentials({
      store: refusingStore,
      userDataDir,
      readLegacySession: () => "good-cookie",
    });

    expect(result.migrated).toEqual([]);
    expect(result.skipped).toEqual(["auth-session-claude-default.json"]);
    expect(
      fs.existsSync(path.join(userDataDir, "auth-session-claude-default.json")),
    ).toBe(true);
    expect(installIdExists()).toBe(true);
  });

  it("is a no-op when there is nothing to migrate", () => {
    const result = migrateLegacyCredentials({
      store,
      userDataDir,
      readLegacySession: () => "unused",
    });

    expect(result).toEqual({ migrated: [], removed: [], skipped: [] });
  });

  it("does not throw when the userData directory is missing", () => {
    const missingDir = path.join(userDataDir, "does-not-exist");

    expect(() =>
      migrateLegacyCredentials({
        store,
        userDataDir: missingDir,
        readLegacySession: () => "unused",
      }),
    ).not.toThrow();
  });

  it("is idempotent across repeated runs", () => {
    writeLegacyFile("auth-session-claude-default.json");
    writeInstallId();
    const options = {
      store,
      userDataDir,
      readLegacySession: () => "good-cookie",
    };

    const first = migrateLegacyCredentials(options);
    const second = migrateLegacyCredentials(options);

    expect(first.migrated).toEqual(["claude-default"]);
    expect(second).toEqual({ migrated: [], removed: [], skipped: [] });
    expect(store.read("claude-default")).toBe("good-cookie");
  });
});
