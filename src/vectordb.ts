import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { getEmbeddingDimensions } from "./embeddings.js";

const DB_DIR = process.env.PAPERLESS_MCP_DATA || join(homedir(), ".paperless-mcp");
const DB_PATH = join(DB_DIR, "vectors.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  sqliteVec.load(db);

  const dims = getEmbeddingDimensions();

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY,
      title TEXT,
      content_hash TEXT,
      updated_at TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  const storedDims = db
    .prepare("SELECT value FROM sync_state WHERE key = 'embedding_dimensions'")
    .get() as { value: string } | undefined;
  if (storedDims && parseInt(storedDims.value, 10) !== dims) {
    db.exec("DROP TABLE IF EXISTS vec_documents");
    db.exec("DELETE FROM documents");
    db.prepare("DELETE FROM sync_state WHERE key = 'embedding_dimensions'").run();
    console.error(
      `Embedding dimensions changed from ${storedDims.value} to ${dims}. Vector index has been reset. Run sync_embeddings to re-index.`,
    );
  }

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_documents USING vec0(
      embedding float[${dims}]
    )
  `);

  if (!storedDims || parseInt(storedDims.value, 10) !== dims) {
    db.prepare(
      "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('embedding_dimensions', ?)",
    ).run(String(dims));
  }

  return db;
}

export function upsertDocument(
  id: number,
  title: string,
  contentHash: string,
  embedding: number[],
) {
  const d = getDb();
  const embBuf = Buffer.from(new Float32Array(embedding).buffer);
  const tx = d.transaction(() => {
    const existing = d.prepare("SELECT content_hash FROM documents WHERE id = ?").get(id) as
      | { content_hash: string }
      | undefined;
    if (existing) {
      d.prepare(
        "UPDATE documents SET title = ?, content_hash = ?, updated_at = ? WHERE id = ?",
      ).run(title, contentHash, new Date().toISOString(), id);
      d.prepare("UPDATE vec_documents SET embedding = ? WHERE rowid = ?").run(embBuf, BigInt(id));
    } else {
      d.prepare(
        "INSERT INTO documents (id, title, content_hash, updated_at) VALUES (?, ?, ?, ?)",
      ).run(id, title, contentHash, new Date().toISOString());
      d.prepare("INSERT INTO vec_documents (rowid, embedding) VALUES (?, ?)").run(
        BigInt(id),
        embBuf,
      );
    }
  });
  tx();
}

export function removeDocument(id: number) {
  const d = getDb();
  const tx = d.transaction(() => {
    d.prepare("DELETE FROM documents WHERE id = ?").run(id);
    d.prepare("DELETE FROM vec_documents WHERE rowid = ?").run(BigInt(id));
  });
  tx();
}

export interface SearchResult {
  id: number;
  title: string;
  distance: number;
}

export function searchSimilar(embedding: number[], limit: number = 10): SearchResult[] {
  const d = getDb();
  const rows = d
    .prepare(
      `
    SELECT v.rowid as id, d.title, v.distance
    FROM vec_documents v
    JOIN documents d ON d.id = v.rowid
    WHERE v.embedding MATCH ? AND k = ?
    ORDER BY v.distance
  `,
    )
    .all(Buffer.from(new Float32Array(embedding).buffer), limit) as SearchResult[];
  return rows;
}

export function getIndexedDocIds(): number[] {
  const d = getDb();
  return (d.prepare("SELECT id FROM documents").all() as { id: number }[]).map((r) => r.id);
}

export function getDocumentHash(id: number): string | undefined {
  const d = getDb();
  const row = d.prepare("SELECT content_hash FROM documents WHERE id = ?").get(id) as
    | { content_hash: string }
    | undefined;
  return row?.content_hash;
}

export function getSyncState(key: string): string | undefined {
  const d = getDb();
  const row = d.prepare("SELECT value FROM sync_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSyncState(key: string, value: string) {
  const d = getDb();
  d.prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)").run(key, value);
}

export function getStats() {
  const d = getDb();
  const count = (d.prepare("SELECT COUNT(*) as c FROM documents").get() as { c: number }).c;
  return { indexed_documents: count, db_path: DB_PATH };
}
