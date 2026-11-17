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
    await expect(createServer(adminClient)).resolves.toBeDefined();
  });

  it("builds a server without throwing when embeddings are disabled", async () => {
    vi.resetModules();
    process.env.PAPERLESS_URL = "https://p.example.com";
    process.env.PAPERLESS_TOKEN = "admin-tok";
    process.env.EMBEDDINGS_ENABLED = "false";
    const { createServer } = await import("../server.js");
    const { adminClient } = await import("../config.js");
    await expect(createServer(adminClient)).resolves.toBeDefined();
  });

  it("advertises populated input schemas over tools/list", async () => {
    vi.resetModules();
    process.env.PAPERLESS_URL = "https://p.example.com";
    process.env.PAPERLESS_TOKEN = "admin-tok";
    process.env.EMBEDDINGS_ENABLED = "false";
    const { createServer } = await import("../server.js");
    const { adminClient } = await import("../config.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const server = await createServer(adminClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    const schemas = new Map(tools.map((t) => [t.name, t.inputSchema as any]));

    for (const [name, schema] of schemas) expect(schema.type, name).toBe("object");
    expect(schemas.get("get_status").properties).toEqual({});

    const getDocument = schemas.get("get_document");
    expect(getDocument.properties.id).toMatchObject({ type: "number" });
    expect(getDocument.required).toEqual(["id"]);

    const updateDocument = schemas.get("update_document");
    expect(updateDocument.required).toEqual(["id"]);
    expect(updateDocument.properties.correspondent.type).toEqual(["number", "null"]);
    expect(updateDocument.properties.tags).toMatchObject({
      type: "array",
      items: { type: "number" },
    });
    expect(updateDocument.properties.custom_fields.items.required).toEqual(["field"]);

    expect(schemas.get("bulk_edit_documents").properties.parameters).toMatchObject({
      type: "object",
      description: "Operation-specific parameters",
    });
    expect(schemas.get("list_tasks").properties.trigger_source.enum).toContain("scheduled");
  });
});
