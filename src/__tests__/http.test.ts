import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("PAPERLESS_URL", "https://p.example.com");
vi.stubEnv("PAPERLESS_TOKEN", "admin-tok");

const { extractToken } = await import("../http.js");

describe("extractToken", () => {
  it("reads a Bearer token", () =>
    expect(extractToken({ authorization: "Bearer abc123" })).toBe("abc123"));
  it("reads X-Paperless-Token as fallback", () =>
    expect(extractToken({ "x-paperless-token": "tok-9" })).toBe("tok-9"));
  it("prefers Authorization over X-Paperless-Token", () =>
    expect(extractToken({ authorization: "Bearer a", "x-paperless-token": "b" })).toBe("a"));
  it("returns null when absent, empty, or non-Bearer", () => {
    expect(extractToken({})).toBeNull();
    expect(extractToken({ authorization: "Bearer " })).toBeNull();
    expect(extractToken({ authorization: "Basic xyz" })).toBeNull();
  });
});

describe("originAllowed / hostAllowed", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.PAPERLESS_URL = "https://p.example.com";
    process.env.PAPERLESS_TOKEN = "admin-tok";
    delete process.env.MCP_ALLOWED_ORIGINS;
    delete process.env.MCP_ALLOWED_HOSTS;
  });

  it("by default allows requests without an Origin and blocks any browser Origin", async () => {
    const { originAllowed } = await import("../http.js");
    expect(originAllowed(undefined)).toBe(true);
    expect(originAllowed("https://evil.example.com")).toBe(false);
  });

  it("by default disables host validation", async () => {
    const { hostAllowed } = await import("../http.js");
    expect(hostAllowed("anything:3001")).toBe(true);
    expect(hostAllowed(undefined)).toBe(true);
  });

  it("honors a configured origin allowlist (and the * wildcard)", async () => {
    process.env.MCP_ALLOWED_ORIGINS = "https://app.example.com";
    const { originAllowed } = await import("../http.js");
    expect(originAllowed("https://app.example.com")).toBe(true);
    expect(originAllowed("https://evil.example.com")).toBe(false);
    expect(originAllowed(undefined)).toBe(true);

    vi.resetModules();
    process.env.MCP_ALLOWED_ORIGINS = "*";
    const { originAllowed: anyOrigin } = await import("../http.js");
    expect(anyOrigin("https://evil.example.com")).toBe(true);
  });

  it("honors a configured host allowlist, matching with or without port", async () => {
    process.env.MCP_ALLOWED_HOSTS = "mcp.example.com";
    const { hostAllowed } = await import("../http.js");
    expect(hostAllowed("mcp.example.com")).toBe(true);
    expect(hostAllowed("mcp.example.com:3001")).toBe(true);
    expect(hostAllowed("127.0.0.1:3001")).toBe(false);
    expect(hostAllowed(undefined)).toBe(false);
  });
});
