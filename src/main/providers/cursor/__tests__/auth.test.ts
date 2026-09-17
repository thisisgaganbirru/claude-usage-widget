import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_KEY,
  decodeStateValue,
  EMAIL_KEY,
  MEMBERSHIP_KEY,
  readCursorAuth,
  sessionCookie,
  userIdFromToken,
  type StateReader,
} from "../auth";
import { stateDbCandidates } from "../paths";

const HOME = path.join(path.sep, "home", "ada");

function jwt(claims: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.signature`;
}

const TOKEN = jwt({ sub: "auth0|user_01ABC", exp: 1800000000 });

/** A reader backed by a plain map, standing in for the SQLite file. */
function readerFor(contents: Record<string, Map<string, string>>): StateReader {
  return async (file) => {
    const found = contents[file];
    if (found === undefined) throw new Error("no such file");
    return found;
  };
}

describe("stateDbCandidates", () => {
  it("uses Application Support on macOS", () => {
    expect(
      stateDbCandidates({ env: {}, homeDir: HOME, platform: "darwin" }),
    ).toEqual([
      path.join(
        HOME,
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
    ]);
  });

  it("prefers APPDATA on Windows and keeps a fallback", () => {
    const candidates = stateDbCandidates({
      env: { APPDATA: "C:\\Users\\ada\\AppData\\Roaming" },
      homeDir: HOME,
      platform: "win32",
    });

    expect(candidates[0]).toContain("C:\\Users\\ada\\AppData\\Roaming");
    expect(candidates).toHaveLength(2);
  });

  it("prefers XDG_CONFIG_HOME on Linux and falls through to ~/.config", () => {
    const candidates = stateDbCandidates({
      env: { XDG_CONFIG_HOME: path.join(HOME, "cfg") },
      homeDir: HOME,
      platform: "linux",
    });

    expect(candidates[0]).toContain(path.join(HOME, "cfg", "Cursor"));
    expect(candidates[1]).toContain(path.join(HOME, ".config", "Cursor"));
  });
});

describe("decodeStateValue", () => {
  it("reads a TEXT value", () => {
    expect(decodeStateValue("token")).toBe("token");
    expect(decodeStateValue("")).toBeNull();
  });

  it("reads a UTF-8 BLOB", () => {
    expect(decodeStateValue(new Uint8Array(Buffer.from("token", "utf8")))).toBe(
      "token",
    );
  });

  it("reads a BOM-less UTF-16LE BLOB", () => {
    expect(
      decodeStateValue(new Uint8Array(Buffer.from("token", "utf16le"))),
    ).toBe("token");
  });

  it("reads a UTF-16LE BLOB that carries a BOM", () => {
    const bom = Buffer.from([0xff, 0xfe]);
    const body = Buffer.from("token", "utf16le");
    expect(decodeStateValue(new Uint8Array(Buffer.concat([bom, body])))).toBe(
      "token",
    );
  });

  it("returns null for an empty or unreadable value", () => {
    expect(decodeStateValue(new Uint8Array(0))).toBeNull();
    expect(decodeStateValue(null)).toBeNull();
    expect(decodeStateValue(42)).toBeNull();
  });
});

describe("userIdFromToken", () => {
  it("takes the part after the provider prefix", () => {
    expect(userIdFromToken(TOKEN)).toBe("user_01ABC");
  });

  it("takes the whole sub when there is no prefix", () => {
    expect(userIdFromToken(jwt({ sub: "user_02DEF" }))).toBe("user_02DEF");
  });

  it("returns null when there is no readable sub", () => {
    expect(userIdFromToken(jwt({ email: "ada@example.com" }))).toBeNull();
    expect(userIdFromToken("not-a-jwt")).toBeNull();
  });
});

describe("sessionCookie", () => {
  it("joins the user id and the token the way Cursor's client does", () => {
    expect(sessionCookie(TOKEN)).toBe(
      `WorkosCursorSessionToken=user_01ABC%3A%3A${TOKEN}`,
    );
  });

  it("returns null for a token with no user id in it", () => {
    expect(sessionCookie("not-a-jwt")).toBeNull();
  });
});

describe("readCursorAuth", () => {
  it("reads the first database that holds a sign-in", async () => {
    const found = await readCursorAuth(
      ["/missing.vscdb", "/found.vscdb"],
      readerFor({
        "/found.vscdb": new Map([
          [ACCESS_TOKEN_KEY, TOKEN],
          [EMAIL_KEY, "ada@example.com"],
          [MEMBERSHIP_KEY, "pro"],
        ]),
      }),
    );

    expect(found).toEqual({
      accessToken: TOKEN,
      email: "ada@example.com",
      membership: "pro",
      source: "/found.vscdb",
    });
  });

  it("steps over a database that has the table but no token", async () => {
    const found = await readCursorAuth(
      ["/empty.vscdb", "/found.vscdb"],
      readerFor({
        "/empty.vscdb": new Map([[EMAIL_KEY, "ada@example.com"]]),
        "/found.vscdb": new Map([[ACCESS_TOKEN_KEY, TOKEN]]),
      }),
    );

    expect(found?.source).toBe("/found.vscdb");
    expect(found?.email).toBeNull();
  });

  it("returns null when Cursor is not signed in on this machine", async () => {
    expect(await readCursorAuth(["/missing.vscdb"], readerFor({}))).toBeNull();
  });
});
