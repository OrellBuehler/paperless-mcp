import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.stubEnv("PAPERLESS_URL", "http://localhost:8000");
vi.stubEnv("PAPERLESS_TOKEN", "test-token");
vi.stubEnv("EMBEDDING_PROVIDER", "openai");
vi.stubEnv("EMBEDDING_DIMENSIONS", "4");
vi.stubEnv("OPENAI_API_KEY", "sk-test");

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "paperless-mcp-test-"));
  vi.stubEnv("PAPERLESS_MCP_DATA", tempDir);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("vectordb", () => {
  it("initializes database and creates tables", async () => {
    const { getDb } = await import("../vectordb.js");
    const db = getDb();
    expect(db).toBeDefined();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("documents");
    expect(names).toContain("sync_state");
  });

  it("returns same db instance on subsequent calls", async () => {
    const { getDb } = await import("../vectordb.js");
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it("upserts and retrieves document hash", async () => {
    const { upsertDocument, getDocumentHash } = await import("../vectordb.js");
    upsertDocument(1, "Test Doc", "abc123", [0.1, 0.2, 0.3, 0.4]);

    expect(getDocumentHash(1)).toBe("abc123");
  });

  it("returns undefined hash for non-existent document", async () => {
    const { getDocumentHash } = await import("../vectordb.js");
    expect(getDocumentHash(999)).toBeUndefined();
  });

  it("updates existing document on upsert", async () => {
    const { upsertDocument, getDocumentHash, getIndexedDocIds } = await import("../vectordb.js");

    upsertDocument(1, "Original", "hash1", [0.1, 0.2, 0.3, 0.4]);
    upsertDocument(1, "Updated", "hash2", [0.5, 0.6, 0.7, 0.8]);

    expect(getDocumentHash(1)).toBe("hash2");
    expect(getIndexedDocIds()).toEqual([1]);
  });

  it("tracks indexed document IDs", async () => {
    const { upsertDocument, getIndexedDocIds } = await import("../vectordb.js");

    expect(getIndexedDocIds()).toEqual([]);

    upsertDocument(1, "Doc 1", "h1", [0.1, 0.2, 0.3, 0.4]);
    upsertDocument(2, "Doc 2", "h2", [0.5, 0.6, 0.7, 0.8]);

    const ids = getIndexedDocIds();
    expect(ids).toHaveLength(2);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  it("removes document from index", async () => {
    const { upsertDocument, removeDocument, getIndexedDocIds, getDocumentHash } =
      await import("../vectordb.js");

    upsertDocument(1, "Doc 1", "h1", [0.1, 0.2, 0.3, 0.4]);
    upsertDocument(2, "Doc 2", "h2", [0.5, 0.6, 0.7, 0.8]);

    removeDocument(1);

    expect(getIndexedDocIds()).toEqual([2]);
    expect(getDocumentHash(1)).toBeUndefined();
  });

  it("searches similar documents by vector distance", async () => {
    const { upsertDocument, searchSimilar } = await import("../vectordb.js");

    upsertDocument(1, "Cat Document", "h1", [1.0, 0.0, 0.0, 0.0]);
    upsertDocument(2, "Dog Document", "h2", [0.0, 1.0, 0.0, 0.0]);
    upsertDocument(3, "Another Cat", "h3", [0.9, 0.1, 0.0, 0.0]);

    const results = searchSimilar([1.0, 0.0, 0.0, 0.0], 2);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe(1);
    expect(results[0].title).toBe("Cat Document");
    expect(results[0].distance).toBeDefined();
    expect(results[1].id).toBe(3);
  });

  it("respects search limit", async () => {
    const { upsertDocument, searchSimilar } = await import("../vectordb.js");

    upsertDocument(1, "A", "h1", [0.1, 0.2, 0.3, 0.4]);
    upsertDocument(2, "B", "h2", [0.5, 0.6, 0.7, 0.8]);
    upsertDocument(3, "C", "h3", [0.9, 0.1, 0.2, 0.3]);

    const results = searchSimilar([0.1, 0.2, 0.3, 0.4], 1);
    expect(results).toHaveLength(1);
  });

  it("manages sync state", async () => {
    const { getSyncState, setSyncState } = await import("../vectordb.js");

    expect(getSyncState("last_sync")).toBeUndefined();

    setSyncState("last_sync", "2024-01-01");
    expect(getSyncState("last_sync")).toBe("2024-01-01");

    setSyncState("last_sync", "2024-06-15");
    expect(getSyncState("last_sync")).toBe("2024-06-15");
  });

  it("returns stats", async () => {
    const { upsertDocument, getStats } = await import("../vectordb.js");

    const stats0 = getStats();
    expect(stats0.indexed_documents).toBe(0);
    expect(stats0.db_path).toContain("vectors.db");

    upsertDocument(1, "Doc", "h1", [0.1, 0.2, 0.3, 0.4]);

    const stats1 = getStats();
    expect(stats1.indexed_documents).toBe(1);
  });

  it("stores embedding dimensions in sync state", async () => {
    const { getDb, getSyncState } = await import("../vectordb.js");
    getDb();
    expect(getSyncState("embedding_dimensions")).toBe("4");
  });
});

describe("vectordb dimension change", () => {
  it("resets index when dimensions change", async () => {
    const { upsertDocument, getIndexedDocIds, getDb } = await import("../vectordb.js");
    upsertDocument(1, "Doc", "h1", [0.1, 0.2, 0.3, 0.4]);
    expect(getIndexedDocIds()).toEqual([1]);

    const db = getDb();
    db.close();

    vi.stubEnv("EMBEDDING_DIMENSIONS", "8");
    vi.resetModules();

    const mod2 = await import("../vectordb.js");
    mod2.getDb();

    expect(mod2.getIndexedDocIds()).toEqual([]);
    expect(mod2.getSyncState("embedding_dimensions")).toBe("8");
  });
});
