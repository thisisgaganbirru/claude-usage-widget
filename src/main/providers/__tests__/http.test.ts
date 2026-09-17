import { describe, expect, it } from "vitest";
import { parseRetryAfter } from "../http";

const NOW = Date.parse("2026-03-10T00:00:00.000Z");

describe("parseRetryAfter", () => {
  it("reads a delay in seconds", () => {
    expect(parseRetryAfter("120", NOW)).toBe(120);
    expect(parseRetryAfter("  3600  ", NOW)).toBe(3600);
  });

  it("turns an HTTP date into seconds from now", () => {
    expect(parseRetryAfter("Tue, 10 Mar 2026 00:05:00 GMT", NOW)).toBe(300);
  });

  it("rejects a zero delay rather than retrying immediately", () => {
    // Claude's usage endpoint has answered `Retry-After: 0` while still
    // refusing the request; honouring it turns a rate limit into a loop.
    expect(parseRetryAfter("0", NOW)).toBeNull();
  });

  it("rejects a date that has already passed", () => {
    expect(parseRetryAfter("Mon, 09 Mar 2026 23:55:00 GMT", NOW)).toBeNull();
  });

  it("returns null for a header it cannot read", () => {
    expect(parseRetryAfter(undefined, NOW)).toBeNull();
    expect(parseRetryAfter("", NOW)).toBeNull();
    expect(parseRetryAfter("soon", NOW)).toBeNull();
  });
});
