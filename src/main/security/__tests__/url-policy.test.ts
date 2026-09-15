import { describe, expect, it } from "vitest";
import {
  DEVTOOLS_ORIGIN,
  FILE_ORIGIN,
  classifyExternalUrl,
  describeUrlForLog,
  isNavigationAllowed,
  originOf,
} from "@main/security/url-policy";

const EXTERNAL = ["https://claude.ai", "https://chatgpt.com"];

describe("originOf", () => {
  it("returns the real origin for http(s) URLs", () => {
    expect(originOf("https://claude.ai/settings/usage")).toBe(
      "https://claude.ai",
    );
    expect(originOf("http://localhost:5000/main_window")).toBe(
      "http://localhost:5000",
    );
  });

  it("keeps the port as part of the origin", () => {
    expect(originOf("https://claude.ai:8443/")).toBe("https://claude.ai:8443");
  });

  it("collapses file and devtools URLs onto their markers", () => {
    expect(originOf("file:///C:/app/index.html")).toBe(FILE_ORIGIN);
    expect(originOf("devtools://devtools/bundled/devtools_app.html")).toBe(
      DEVTOOLS_ORIGIN,
    );
  });

  it("rejects opaque and unparseable URLs", () => {
    expect(originOf("about:blank")).toBeNull();
    expect(originOf("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(originOf("not a url")).toBeNull();
    expect(originOf("")).toBeNull();
  });
});

describe("isNavigationAllowed", () => {
  it("allows an exact origin match", () => {
    expect(isNavigationAllowed("https://claude.ai/login", EXTERNAL)).toBe(true);
  });

  it("refuses a different host that merely starts the same", () => {
    expect(
      isNavigationAllowed("https://claude.ai.evil.example/", EXTERNAL),
    ).toBe(false);
  });

  it("refuses userinfo smuggling that defeats prefix checks", () => {
    expect(
      isNavigationAllowed("https://claude.ai@evil.example/steal", EXTERNAL),
    ).toBe(false);
  });

  it("refuses the same host over http", () => {
    expect(isNavigationAllowed("http://claude.ai/login", EXTERNAL)).toBe(false);
  });

  it("refuses javascript and data URLs", () => {
    expect(isNavigationAllowed("javascript:alert(1)", EXTERNAL)).toBe(false);
    expect(isNavigationAllowed("data:text/html,hi", EXTERNAL)).toBe(false);
  });

  it("allows file URLs only when the marker is in the list", () => {
    expect(isNavigationAllowed("file:///app/index.html", EXTERNAL)).toBe(false);
    expect(isNavigationAllowed("file:///app/index.html", [FILE_ORIGIN])).toBe(
      true,
    );
  });

  it("allows nothing when the list is empty", () => {
    expect(isNavigationAllowed("https://claude.ai/", [])).toBe(false);
  });
});

describe("classifyExternalUrl", () => {
  it("allows an https URL on an allowed origin", () => {
    expect(classifyExternalUrl("https://claude.ai/settings", EXTERNAL)).toEqual(
      {
        allowed: true,
        url: "https://claude.ai/settings",
      },
    );
  });

  it("refuses non-https schemes that would launch an OS handler", () => {
    for (const raw of [
      "file:///etc/passwd",
      "smb://fileserver/share",
      "ms-msdt:/id",
      "http://claude.ai/",
    ]) {
      expect(classifyExternalUrl(raw, EXTERNAL)).toEqual({
        allowed: false,
        reason: "insecure-scheme",
      });
    }
  });

  it("refuses embedded credentials", () => {
    expect(classifyExternalUrl("https://user:pw@claude.ai/", EXTERNAL)).toEqual(
      { allowed: false, reason: "embedded-credentials" },
    );
  });

  it("refuses an origin outside the allowlist", () => {
    expect(classifyExternalUrl("https://evil.example/", EXTERNAL)).toEqual({
      allowed: false,
      reason: "origin-not-allowed",
    });
    expect(
      classifyExternalUrl("https://claude.ai.evil.example/", EXTERNAL),
    ).toEqual({ allowed: false, reason: "origin-not-allowed" });
  });

  it("refuses malformed input", () => {
    expect(classifyExternalUrl("", EXTERNAL)).toEqual({
      allowed: false,
      reason: "malformed",
    });
    expect(classifyExternalUrl("://", EXTERNAL)).toEqual({
      allowed: false,
      reason: "malformed",
    });
  });
});

describe("describeUrlForLog", () => {
  it("drops the query and fragment that carry OAuth codes", () => {
    expect(
      describeUrlForLog("https://claude.ai/auth?code=secret#token=also-secret"),
    ).toBe("https://claude.ai/auth");
  });

  it("keeps file paths readable", () => {
    expect(describeUrlForLog("file:///app/index.html")).toBe(
      "file:///app/index.html",
    );
  });

  it("does not throw on junk", () => {
    expect(describeUrlForLog("nope")).toBe("<unparseable url>");
  });
});
