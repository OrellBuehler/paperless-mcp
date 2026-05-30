import { describe, it, expect, beforeEach, vi } from "vitest";

describe("config", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.PAPERLESS_URL = "https://p.example.com/";
    process.env.PAPERLESS_TOKEN = "admin-tok";
    delete process.env.MCP_TRANSPORT;
    delete process.env.PORT;
    delete process.env.EMBEDDINGS_ENABLED;
  });

  it("defaults transport=stdio, port=3001, embeddings off, strips trailing slash", async () => {
    const { config } = await import("../config.js");
    expect(config.transport).toBe("stdio");
    expect(config.port).toBe(3001);
    expect(config.embeddingsEnabled).toBe(false);
    expect(config.baseUrl).toBe("https://p.example.com");
    expect(config.adminToken).toBe("admin-tok");
  });

  it("reads http transport, custom port, embeddings on", async () => {
    process.env.MCP_TRANSPORT = "http";
    process.env.PORT = "9000";
    process.env.EMBEDDINGS_ENABLED = "true";
    const { config } = await import("../config.js");
    expect(config.transport).toBe("http");
    expect(config.port).toBe(9000);
    expect(config.embeddingsEnabled).toBe(true);
  });

  it("adminClient uses the admin token and base url", async () => {
    const { adminClient, config } = await import("../config.js");
    expect(adminClient.token).toBe("admin-tok");
    expect(adminClient.baseUrl).toBe(config.baseUrl);
  });

  it("clientFor caches by token; admin token returns adminClient", async () => {
    const { clientFor, adminClient } = await import("../config.js");
    expect(clientFor("u1")).toBe(clientFor("u1"));
    expect(clientFor("u1")).not.toBe(clientFor("u2"));
    expect(clientFor("u2").token).toBe("u2");
    expect(clientFor("admin-tok")).toBe(adminClient);
  });
});
