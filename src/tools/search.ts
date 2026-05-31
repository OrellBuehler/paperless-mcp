import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { ok, err, buildQS } from "../paperless/format.js";
import type { PaperlessClient } from "../paperless/client.js";
import { config, adminClient } from "../config.js";
import { embed, embedSingle, getProviderInfo } from "../embeddings.js";
import {
  upsertDocument,
  searchSimilar,
  getIndexedDocIds,
  getDocumentHash,
  getStats,
  removeDocument,
} from "../vectordb.js";

interface PaperlessDocument {
  id: number;
  title: string;
  content?: string;
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function registerSearchTools(server: McpServer, client: PaperlessClient) {
  server.tool(
    "semantic_search",
    "Search documents by meaning using vector embeddings. Requires sync_embeddings to be run first.",
    {
      query: z.string().describe("Natural language search query"),
      limit: z.number().optional().describe("Max results (default 10)"),
    },
    async ({ query, limit }) => {
      try {
        const limitN = limit || 10;
        const queryEmbedding = await embedSingle(query);
        // Over-fetch from the global index, then drop docs the user's token
        // cannot see, so permission filtering doesn't starve restricted users.
        const hits = searchSimilar(queryEmbedding, limitN * 5);
        if (hits.length === 0) return ok({ count: 0, results: [] });
        const ids = hits.map((h) => h.id);
        const resp = (await client.fetch(
          `/api/documents/${buildQS({ id__in: ids, page_size: ids.length })}`,
        )) as { results?: { id: number }[] };
        const allowed = new Set((resp.results || []).map((d) => d.id));
        const results = hits
          .filter((h) => allowed.has(h.id))
          .slice(0, limitN)
          .map((h) => ({ id: h.id, title: h.title, distance: h.distance }));
        return ok({ count: results.length, results });
      } catch (e) {
        return err(e);
      }
    },
  );

  if (client.token === config.adminToken) {
    server.tool(
      "sync_embeddings",
      "Sync document embeddings to the local vector database. Indexes all documents for semantic search. Only re-embeds documents whose content has changed. Admin only.",
      {
        force: z.boolean().optional().describe("Force re-embedding of all documents"),
      },
      async ({ force }) => {
        try {
          const provider = getProviderInfo();
          const docs = await adminClient.fetchAllPages<PaperlessDocument>("/api/documents/");
          const indexedIds = new Set(getIndexedDocIds());
          let indexed = 0;
          let skipped = 0;
          let removed = 0;
          const errors: string[] = [];
          const BATCH_SIZE = 20;

          const currentIds = new Set(docs.map((d) => d.id));
          for (const id of indexedIds) {
            if (!currentIds.has(id)) {
              removeDocument(id);
              removed++;
            }
          }

          for (let i = 0; i < docs.length; i += BATCH_SIZE) {
            const batch = docs.slice(i, i + BATCH_SIZE);
            const toEmbed: { doc: PaperlessDocument; content: string; hash: string }[] = [];

            for (const doc of batch) {
              try {
                let content = doc.content;
                if (!content) {
                  const detail = (await adminClient.fetch(
                    `/api/documents/${doc.id}/`,
                  )) as PaperlessDocument;
                  content = detail.content;
                }
                if (!content) {
                  skipped++;
                  continue;
                }
                const hash = contentHash(content);
                if (!force && getDocumentHash(doc.id) === hash) {
                  skipped++;
                  continue;
                }
                toEmbed.push({ doc, content, hash });
              } catch (e) {
                errors.push(`Doc ${doc.id}: ${e}`);
              }
            }

            if (toEmbed.length === 0) continue;

            try {
              const texts = toEmbed.map((t) => `${t.doc.title}\n\n${t.content}`.slice(0, 8000));
              const embeddings = await embed(texts);
              for (let j = 0; j < toEmbed.length; j++) {
                upsertDocument(
                  toEmbed[j].doc.id,
                  toEmbed[j].doc.title,
                  toEmbed[j].hash,
                  embeddings[j],
                );
                indexed++;
              }
            } catch (e) {
              errors.push(`Batch embed error: ${e}`);
            }
          }

          const stats = getStats();
          return ok({
            provider,
            indexed,
            skipped,
            removed,
            total_in_db: stats.indexed_documents,
            db_path: stats.db_path,
            errors: errors.length > 0 ? errors : undefined,
          });
        } catch (e) {
          return err(e);
        }
      },
    );
  }

  server.tool(
    "embedding_status",
    "Get the status of the local vector embedding database",
    {},
    async () => {
      try {
        const { db_path, ...stats } = getStats();
        const provider = getProviderInfo();
        const isAdmin = client.token === config.adminToken;
        return ok({ ...stats, ...(isAdmin ? { db_path } : {}), ...provider });
      } catch (e) {
        return err(e);
      }
    },
  );
}
