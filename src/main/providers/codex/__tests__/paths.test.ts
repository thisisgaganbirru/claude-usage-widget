import * as path from "path";
import { describe, expect, it } from "vitest";
import { authFileCandidates, codexHome, sessionsDir } from "../paths";

const HOME = path.join(path.sep, "home", "ada");

describe("codexHome", () => {
  it("defaults to ~/.codex", () => {
    expect(codexHome({}, HOME)).toBe(path.join(HOME, ".codex"));
  });

  it("honours CODEX_HOME, which multi-account setups rely on", () => {
    const elsewhere = path.join(path.sep, "work", "codex");
    expect(codexHome({ CODEX_HOME: elsewhere }, HOME)).toBe(elsewhere);
  });

  it("ignores an override that is blank", () => {
    expect(codexHome({ CODEX_HOME: "   " }, HOME)).toBe(
      path.join(HOME, ".codex"),
    );
  });
});

describe("authFileCandidates", () => {
  it("puts the current location ahead of the legacy one", () => {
    expect(authFileCandidates({}, HOME)).toEqual([
      path.join(HOME, ".codex", "auth.json"),
      path.join(HOME, ".config", "codex", "auth.json"),
    ]);
  });
});

describe("sessionsDir", () => {
  it("sits under the codex home, override included", () => {
    const elsewhere = path.join(path.sep, "work", "codex");
    expect(sessionsDir({ CODEX_HOME: elsewhere }, HOME)).toBe(
      path.join(elsewhere, "sessions"),
    );
  });
});
