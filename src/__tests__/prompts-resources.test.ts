import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.stubEnv("PAPERLESS_URL", "http://localhost:8000");
vi.stubEnv("PAPERLESS_TOKEN", "admin-token");
vi.stubEnv("EMBEDDINGS_ENABLED", "true");
vi.stubEnv("EMBEDDING_PROVIDER", "openai");
vi.stubEnv("OPENAI_API_KEY", "test-key");

const { createServer } = await import("../server.js");
const { PaperlessClient } = await import("../paperless/client.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

async function connect(token = "user-token") {
  const server = await createServer(new PaperlessClient("http://localhost:8000", token));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

function mockJson(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function page(results: unknown[], next: string | null = null) {
  return mockJson({ count: results.length, next, previous: null, results });
}

function promptText(res: { messages: { content: { type: string; text?: string } }[] }) {
  return res.messages.map((m) => m.content.text ?? "").join("\n");
}

describe("prompts", () => {
  it("lists all prompts with their arguments", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      "cleanup_tags",
      "find_document",
      "monthly_review",
      "tax_prep",
      "triage_inbox",
    ]);
    expect(prompts.find((p) => p.name === "tax_prep")?.arguments).toEqual([
      expect.objectContaining({ name: "year", required: true }),
    ]);
    expect(prompts.find((p) => p.name === "monthly_review")?.arguments).toEqual([
      expect.objectContaining({ name: "month", required: false }),
    ]);
  });

  it("substitutes arguments", async () => {
    const client = await connect();
    const tax = promptText(
      await client.getPrompt({ name: "tax_prep", arguments: { year: "2025" } }),
    );
    expect(tax).toContain("prepare my 2025 tax documents");
    expect(tax).toContain("exist for 2024 but not for 2025");
    expect(tax).toContain("created__date__lte 2025-12-31");

    const review = promptText(
      await client.getPrompt({ name: "monthly_review", arguments: { month: "2024-12" } }),
    );
    expect(review).toContain("year 2024 and month 12");
    expect(review).toContain("added__date__gte 2024-12-01 and added__date__lt 2025-01-01");

    const find = promptText(
      await client.getPrompt({
        name: "find_document",
        arguments: { description: "dentist bill from March" },
      }),
    );
    expect(find).toContain("describing: dentist bill from March");
  });

  it("defaults monthly_review to the previous month", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    try {
      const client = await connect();
      const text = promptText(await client.getPrompt({ name: "monthly_review" }));
      expect(text).toContain("for 2025-12");
      expect(text).toContain("added__date__lt 2026-01-01");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects invalid arguments", async () => {
    const client = await connect();
    await expect(
      client.getPrompt({ name: "tax_prep", arguments: { year: "last year" } }),
    ).rejects.toThrow();
  });

  it("only references tools that exist", async () => {
    const client = await connect("admin-token");
    const toolNames = new Set((await client.listTools()).tools.map((t) => t.name));
    const args: Record<string, Record<string, string>> = {
      tax_prep: { year: "2025" },
      find_document: { description: "x" },
    };
    const { prompts } = await client.listPrompts();
    for (const p of prompts) {
      const text = promptText(await client.getPrompt({ name: p.name, arguments: args[p.name] }));
      const refs = [...text.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
      const tools = refs.filter((r) => r.includes("_"));
      expect(tools.length, p.name).toBeGreaterThan(0);
      for (const t of tools) expect(toolNames.has(t), `${p.name} -> ${t}`).toBe(true);
    }
  });
});

describe("resources", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue(page([]));
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists the static resources and the document template", async () => {
    const client = await connect();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      "paperless://correspondents",
      "paperless://custom-fields",
      "paperless://document-types",
      "paperless://saved-views",
      "paperless://storage-paths",
      "paperless://tags",
    ]);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toEqual(["paperless://documents/{id}"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reads tags across all pages as compact JSON", async () => {
    mockFetch
      .mockResolvedValueOnce(
        page(
          [
            {
              id: 1,
              name: "Inbox",
              slug: "inbox",
              color: "#fff",
              match: "",
              is_inbox_tag: true,
              parent: null,
              document_count: 3,
            },
          ],
          "http://localhost:8000/api/tags/?page=2",
        ),
      )
      .mockResolvedValueOnce(
        page([{ id: 2, name: "Tax", color: "#000", is_inbox_tag: false, document_count: 0 }]),
      );
    const client = await connect();
    const res = await client.readResource({ uri: "paperless://tags" });
    expect(mockFetch.mock.calls.map((c) => String(c[0]))).toEqual([
      "http://localhost:8000/api/tags/?page=1&page_size=100",
      "http://localhost:8000/api/tags/?page=2&page_size=100",
    ]);
    const content = res.contents[0] as { uri: string; mimeType: string; text: string };
    expect(content.uri).toBe("paperless://tags");
    expect(content.mimeType).toBe("application/json");
    expect(JSON.parse(content.text)).toEqual([
      { id: 1, name: "Inbox", color: "#fff", is_inbox_tag: true, parent: null, document_count: 3 },
      { id: 2, name: "Tax", color: "#000", is_inbox_tag: false, document_count: 0 },
    ]);
  });

  it.each([
    ["paperless://correspondents", "/api/correspondents/"],
    ["paperless://document-types", "/api/document_types/"],
    ["paperless://storage-paths", "/api/storage_paths/"],
    ["paperless://custom-fields", "/api/custom_fields/"],
    ["paperless://saved-views", "/api/saved_views/"],
  ])("reads %s from %s", async (uri, path) => {
    mockFetch.mockResolvedValueOnce(page([{ id: 7, name: "X", owner: 1, user_can_change: true }]));
    const client = await connect();
    const res = await client.readResource({ uri });
    expect(String(mockFetch.mock.calls[0][0])).toBe(
      `http://localhost:8000${path}?page=1&page_size=100`,
    );
    expect(JSON.parse((res.contents[0] as { text: string }).text)).toEqual([{ id: 7, name: "X" }]);
  });

  it("reads a document with its content via the template", async () => {
    const doc = { id: 42, title: "Invoice", correspondent: 3, tags: [1], content: "OCR text" };
    mockFetch.mockResolvedValueOnce(mockJson(doc));
    const client = await connect();
    const res = await client.readResource({ uri: "paperless://documents/42" });
    expect(String(mockFetch.mock.calls[0][0])).toBe("http://localhost:8000/api/documents/42/");
    const content = res.contents[0] as { uri: string; text: string };
    expect(content.uri).toBe("paperless://documents/42");
    expect(JSON.parse(content.text)).toEqual(doc);
  });

  it("rejects non-numeric document ids", async () => {
    const client = await connect();
    await expect(
      client.readResource({ uri: "paperless://documents/..%2Fusers" }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses the client passed to createServer, not the admin client", async () => {
    mockFetch.mockResolvedValueOnce(page([])).mockResolvedValueOnce(mockJson({ id: 1 }));
    const client = await connect("user-token");
    await client.readResource({ uri: "paperless://tags" });
    await client.readResource({ uri: "paperless://documents/1" });
    for (const [, opts] of mockFetch.mock.calls) {
      expect((opts as RequestInit).headers).toMatchObject({ Authorization: "Token user-token" });
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
