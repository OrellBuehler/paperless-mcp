import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

describe("contentHash", () => {
  it("returns a 16-char hex string", () => {
    expect(contentHash("hello world")).toMatch(/^[0-9a-f]{16}$/);
  });
  it("is stable and input-sensitive", () => {
    expect(contentHash("a")).toBe(contentHash("a"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });
});

vi.stubEnv("PAPERLESS_URL", "https://p.example.com");
vi.stubEnv("PAPERLESS_TOKEN", "admin-tok");
vi.stubEnv("EMBEDDING_PROVIDER", "openai");
vi.stubEnv("OPENAI_API_KEY", "test-key");

vi.mock("../embeddings.js", () => ({
  embed: vi.fn(),
  embedSingle: vi.fn(async () => [0.1, 0.2, 0.3]),
  getProviderInfo: () => ({ provider: "openai", model: "m", dimensions: 3 }),
}));
vi.mock("../vectordb.js", () => ({
  searchSimilar: vi.fn(() => [
    { id: 1, title: "A", distance: 0.1 },
    { id: 2, title: "B", distance: 0.2 },
    { id: 3, title: "C", distance: 0.3 },
  ]),
  getStats: () => ({ indexed_documents: 3, db_path: "/tmp/x" }),
  upsertDocument: vi.fn(), getIndexedDocIds: () => [], getDocumentHash: () => null, removeDocument: vi.fn(),
}));

const { registerSearchTools } = await import("../tools/search.js");
const { PaperlessClient } = await import("../paperless/client.js");

type H = (a: any) => Promise<{ content: { text: string }[]; isError?: boolean }>;
let tools: Map<string, H>;
function register(c: InstanceType<typeof PaperlessClient>) {
  tools = new Map();
  registerSearchTools({ tool: (n: string, _d: string, _s: unknown, h: H) => tools.set(n, h) } as any, c);
}

describe("semantic_search permission filtering", () => {
  it("returns only docs the user's token can see, preserving vector order", async () => {
    const c = new PaperlessClient("https://p.example.com", "user-tok");
    (c as any).fetch = async () => ({ results: [{ id: 1 }, { id: 3 }] }); // user can't see id 2
    register(c);
    const res = await tools.get("semantic_search")!({ query: "q" });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.results.map((r: { id: number }) => r.id)).toEqual([1, 3]);
    expect(parsed.count).toBe(2);
  });

  it("sizes the permission query to cover every candidate id", async () => {
    const c = new PaperlessClient("https://p.example.com", "user-tok");
    let path = "";
    (c as any).fetch = async (p: string) => { path = p; return { results: [{ id: 1 }, { id: 2 }, { id: 3 }] }; };
    register(c);
    await tools.get("semantic_search")!({ query: "q" });
    expect(path).toContain("id__in=1%2C2%2C3");
    expect(path).toContain("page_size=3");
  });

  it("never returns more than the requested limit", async () => {
    const c = new PaperlessClient("https://p.example.com", "user-tok");
    (c as any).fetch = async () => ({ results: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    register(c);
    const res = await tools.get("semantic_search")!({ query: "q", limit: 2 });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.results.map((r: { id: number }) => r.id)).toEqual([1, 2]);
    expect(parsed.count).toBe(2);
  });
});

describe("sync_embeddings admin gate", () => {
  it("is registered for the admin token", () => {
    register(new PaperlessClient("https://p.example.com", "admin-tok"));
    expect(tools.has("sync_embeddings")).toBe(true);
  });
  it("is NOT registered for a non-admin token; search/status still are", () => {
    register(new PaperlessClient("https://p.example.com", "user-tok"));
    expect(tools.has("sync_embeddings")).toBe(false);
    expect(tools.has("semantic_search")).toBe(true);
    expect(tools.has("embedding_status")).toBe(true);
  });
});

describe("embedding_status db_path exposure", () => {
  it("includes db_path for the admin token", async () => {
    register(new PaperlessClient("https://p.example.com", "admin-tok"));
    const res = await tools.get("embedding_status")!({});
    expect(JSON.parse(res.content[0].text).db_path).toBe("/tmp/x");
  });
  it("omits db_path for a non-admin token", async () => {
    register(new PaperlessClient("https://p.example.com", "user-tok"));
    const res = await tools.get("embedding_status")!({});
    expect(JSON.parse(res.content[0].text).db_path).toBeUndefined();
  });
});
