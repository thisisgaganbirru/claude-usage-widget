import { describe, expect, it } from "vitest";
import { decodeJwtClaims } from "../jwt";

function jwt(claims: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.signature`;
}

describe("decodeJwtClaims", () => {
  it("reads the claims without verifying the signature", () => {
    expect(decodeJwtClaims(jwt({ sub: "user_1" }))).toEqual({ sub: "user_1" });
  });

  it("returns null for anything that is not three segments", () => {
    expect(decodeJwtClaims("not.a-jwt")).toBeNull();
    expect(decodeJwtClaims("")).toBeNull();
  });

  it("returns null when the payload is not a JSON object", () => {
    expect(decodeJwtClaims(jwt(["an", "array"]))).toBeNull();
    expect(decodeJwtClaims("a.$$$.c")).toBeNull();
  });
});
