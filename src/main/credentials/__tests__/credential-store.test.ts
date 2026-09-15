import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CREDENTIAL_FILE_EXTENSION,
  createCredentialStore,
  sanitizeCredentialId,
  type SecureBackend,
} from "../credential-store";

const MAGIC = Buffer.from("FAKE", "utf8");
const KEY = Buffer.from([0x5a, 0x17, 0xc3, 0x2e]);

interface FakeBackendOptions {
  encryptionAvailable?: boolean;
  /** Present only when simulating Linux. */
  storageBackend?: string;
}

/**
 * In-memory stand-in for Electron's safeStorage: XOR against a fixed key,
 * with a magic header and checksum so tampering throws the way the real
 * authenticated ciphertext does.
 */
function createFakeBackend(options: FakeBackendOptions = {}): SecureBackend {
  const backend: SecureBackend = {
    isEncryptionAvailable: () => options.encryptionAvailable !== false,
    encryptString(plain: string): Buffer {
      const body = Buffer.from(plain, "utf8");
      let checksum = 0;
      for (const byte of body) checksum = (checksum + byte) & 0xffff;
      const scrambled = Buffer.from(
        body.map((byte, index) => byte ^ KEY[index % KEY.length]),
      );
      const header = Buffer.alloc(2);
      header.writeUInt16BE(checksum, 0);
      return Buffer.concat([MAGIC, header, scrambled]);
    },
    decryptString(data: Buffer): string {
      if (data.length < 6 || !data.subarray(0, 4).equals(MAGIC)) {
        throw new Error("fake safeStorage: bad header");
      }
      const expected = data.readUInt16BE(4);
      const body = Buffer.from(
        data.subarray(6).map((byte, index) => byte ^ KEY[index % KEY.length]),
      );
      let checksum = 0;
      for (const byte of body) checksum = (checksum + byte) & 0xffff;
      if (checksum !== expected) {
        throw new Error("fake safeStorage: checksum mismatch");
      }
      return body.toString("utf8");
    },
  };
  if (options.storageBackend !== undefined) {
    backend.getSelectedStorageBackend = () => options.storageBackend as string;
  }
  return backend;
}

let tmpRoot: string;
let baseDir: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cred-store-"));
  baseDir = path.join(tmpRoot, "credentials");
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeStore(
  options: FakeBackendOptions = {},
  platform?: NodeJS.Platform,
) {
  return createCredentialStore({
    backend: createFakeBackend(options),
    baseDir,
    platform: platform ?? "linux",
  });
}

function fileFor(id: string): string {
  return path.join(baseDir, `${id}${CREDENTIAL_FILE_EXTENSION}`);
}

describe("sanitizeCredentialId", () => {
  it("keeps safe characters and collapses everything else", () => {
    expect(sanitizeCredentialId("claude-default_1")).toBe("claude-default_1");
    expect(sanitizeCredentialId("../../etc/passwd")).toBe("______etc_passwd");
    expect(sanitizeCredentialId("..\\..\\win")).toBe("______win");
    expect(sanitizeCredentialId("/abs/path")).toBe("_abs_path");
  });

  it("returns an empty id when nothing usable remains", () => {
    expect(sanitizeCredentialId("..")).toBe("");
    expect(sanitizeCredentialId("///")).toBe("");
    expect(sanitizeCredentialId("")).toBe("");
  });
});

describe("createCredentialStore", () => {
  it("round-trips a secret through save and read", () => {
    const store = makeStore({ storageBackend: "gnome_libsecret" });
    const secret = "sessionKey=abc123; Path=/; Secure";

    expect(store.save("claude-default", secret)).toEqual({ ok: true });
    expect(store.read("claude-default")).toBe(secret);
  });

  it("never writes the plaintext to disk", () => {
    const store = makeStore({ storageBackend: "gnome_libsecret" });
    store.save("claude-default", "super-secret-cookie");

    const onDisk = fs.readFileSync(fileFor("claude-default"));
    expect(onDisk.includes("super-secret-cookie")).toBe(false);
  });

  it("returns null for a missing credential", () => {
    const store = makeStore({ storageBackend: "gnome_libsecret" });
    expect(store.read("nope")).toBeNull();
  });

  it.skipIf(process.platform === "win32")(
    "creates the directory 0700 and the file 0600",
    () => {
      const store = makeStore({ storageBackend: "gnome_libsecret" });
      store.save("claude-default", "secret");

      expect(fs.statSync(baseDir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(fileFor("claude-default")).mode & 0o777).toBe(0o600);
    },
  );

  it.skipIf(process.platform === "win32")(
    "tightens permissions on a pre-existing loose directory",
    () => {
      fs.mkdirSync(baseDir, { recursive: true, mode: 0o755 });
      fs.chmodSync(baseDir, 0o755);

      const store = makeStore({ storageBackend: "gnome_libsecret" });
      store.save("claude-default", "secret");

      expect(fs.statSync(baseDir).mode & 0o777).toBe(0o700);
    },
  );

  it("sanitizes ids so they cannot escape the base directory", () => {
    const store = makeStore({ storageBackend: "gnome_libsecret" });
    const escapeAttempt = "../../pwned";

    expect(store.save(escapeAttempt, "secret")).toEqual({ ok: true });
    expect(fs.existsSync(path.join(tmpRoot, "..", "pwned.bin"))).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, "pwned.bin"))).toBe(false);

    const entries = fs.readdirSync(baseDir);
    expect(entries).toEqual(["______pwned.bin"]);
    // The same (sanitized) id still reads back.
    expect(store.read(escapeAttempt)).toBe("secret");
  });

  it("refuses an id with no usable characters", () => {
    const store = makeStore({ storageBackend: "gnome_libsecret" });
    const result = store.save("..", "secret");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("io");
    expect(store.read("..")).toBeNull();
    expect(fs.existsSync(baseDir)).toBe(false);
  });

  it("reports unavailable and writes nothing when encryption is off", () => {
    const store = makeStore({
      encryptionAvailable: false,
      storageBackend: "gnome_libsecret",
    });

    const availability = store.availability();
    expect(availability.ok).toBe(false);
    expect(availability.reason).toBe("unavailable");

    const result = store.save("claude-default", "secret");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unavailable");
      expect(result.message).toMatch(/not saved/i);
    }
    expect(fs.existsSync(baseDir)).toBe(false);
  });

  it("refuses to persist on Linux with an insecure keyring backend", () => {
    for (const selected of ["basic_text", "unknown"]) {
      const store = makeStore({ storageBackend: selected }, "linux");

      const availability = store.availability();
      expect(availability.ok).toBe(false);
      expect(availability.reason).toBe("insecure-backend");

      const result = store.save("claude-default", "secret");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("insecure-backend");
        expect(result.message).toMatch(/not saved/i);
        expect(result.message).toMatch(/keyring/i);
      }
      expect(fs.existsSync(baseDir)).toBe(false);
    }
  });

  it("ignores the Linux backend probe on other platforms", () => {
    const store = makeStore({ storageBackend: "basic_text" }, "darwin");

    expect(store.availability().ok).toBe(true);
    expect(store.save("claude-default", "secret")).toEqual({ ok: true });
    expect(store.read("claude-default")).toBe("secret");
  });

  it("returns null for tampered ciphertext without deleting it", () => {
    const store = makeStore({ storageBackend: "gnome_libsecret" });
    store.save("claude-default", "secret");

    const target = fileFor("claude-default");
    const ciphertext = fs.readFileSync(target);
    ciphertext[ciphertext.length - 1] ^= 0xff;
    fs.writeFileSync(target, ciphertext);

    expect(store.read("claude-default")).toBeNull();
    expect(fs.existsSync(target)).toBe(true);
    expect(store.list()).toEqual(["claude-default"]);
  });

  it("returns null when the file was written by a different key", () => {
    const store = makeStore({ storageBackend: "gnome_libsecret" });
    store.save("claude-default", "secret");
    fs.writeFileSync(fileFor("claude-default"), Buffer.from("NOTFAKEdata"));

    expect(store.read("claude-default")).toBeNull();
  });

  it("writes atomically and leaves no .tmp file behind", () => {
    const store = makeStore({ storageBackend: "gnome_libsecret" });
    store.save("claude-default", "first");
    store.save("claude-default", "second");

    expect(fs.readdirSync(baseDir)).toEqual(["claude-default.bin"]);
    expect(store.read("claude-default")).toBe("second");
  });

  it("overwrites a stale .tmp left by an interrupted write", () => {
    const store = makeStore({ storageBackend: "gnome_libsecret" });
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(`${fileFor("claude-default")}.tmp`, "truncated");

    expect(store.save("claude-default", "secret")).toEqual({ ok: true });
    expect(fs.readdirSync(baseDir)).toEqual(["claude-default.bin"]);
    expect(store.read("claude-default")).toBe("secret");
  });

  it("lists stored ids, sorted, ignoring foreign files", () => {
    const store = makeStore({ storageBackend: "gnome_libsecret" });
    expect(store.list()).toEqual([]);

    store.save("claude-b", "b");
    store.save("claude-a", "a");
    fs.writeFileSync(path.join(baseDir, "notes.txt"), "ignore me");

    expect(store.list()).toEqual(["claude-a", "claude-b"]);
  });

  it("removes a credential and tolerates removing a missing one", () => {
    const store = makeStore({ storageBackend: "gnome_libsecret" });
    store.save("claude-a", "a");
    store.save("claude-b", "b");

    store.remove("claude-a");
    expect(store.list()).toEqual(["claude-b"]);
    expect(store.read("claude-a")).toBeNull();

    expect(() => store.remove("claude-a")).not.toThrow();
    expect(() => store.remove("never-existed")).not.toThrow();
  });
});
