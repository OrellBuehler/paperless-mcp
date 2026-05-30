import { describe, it, expect, vi } from "vitest";

describe("createServer", () => {
  it("builds a server without throwing when embeddings are enabled", async () => {
    vi.resetModules();
    process.env.PAPERLESS_URL = "https://p.example.com";
    process.env.PAPERLESS_TOKEN = "admin-tok";
    process.env.EMBEDDINGS_ENABLED = "true";
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    const { createServer } = await import("../server.js");
    const { adminClient } = await import("../config.js");
    expect(() => createServer(adminClient)).not.toThrow();
  });

  it("builds a server without throwing when embeddings are disabled", async () => {
    vi.resetModules();
    process.env.PAPERLESS_URL = "https://p.example.com";
    process.env.PAPERLESS_TOKEN = "admin-tok";
    process.env.EMBEDDINGS_ENABLED = "false";
    const { createServer } = await import("../server.js");
    const { adminClient } = await import("../config.js");
    expect(() => createServer(adminClient)).not.toThrow();
  });
});
