import { describe, it, expect, vi } from "vitest";

vi.stubEnv("PAPERLESS_URL", "https://p.example.com");
vi.stubEnv("PAPERLESS_TOKEN", "admin-tok");

const { extractToken } = await import("../http.js");

describe("extractToken", () => {
  it("reads a Bearer token", () => expect(extractToken({ authorization: "Bearer abc123" })).toBe("abc123"));
  it("reads X-Paperless-Token as fallback", () => expect(extractToken({ "x-paperless-token": "tok-9" })).toBe("tok-9"));
  it("prefers Authorization over X-Paperless-Token", () =>
    expect(extractToken({ authorization: "Bearer a", "x-paperless-token": "b" })).toBe("a"));
  it("returns null when absent, empty, or non-Bearer", () => {
    expect(extractToken({})).toBeNull();
    expect(extractToken({ authorization: "Bearer " })).toBeNull();
    expect(extractToken({ authorization: "Basic xyz" })).toBeNull();
  });
});
