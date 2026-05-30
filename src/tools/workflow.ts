import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildQS, ok, err } from "../paperless/format.js";
import type { PaginatedResponse } from "../paperless/format.js";
import type { PaperlessClient } from "../paperless/client.js";

interface Suggestion {
  correspondents: number[];
  document_types: number[];
  tags: number[];
  storage_paths: number[];
  dates: string[];
}

interface Document {
  id: number;
  title: string;
  correspondent: number | null;
  document_type: number | null;
  storage_path: number | null;
  tags: number[];
  added: string;
  created: string;
}

export function registerWorkflowTools(server: McpServer, client: PaperlessClient) {
  server.tool(
    "auto_classify_document",
    "Get AI suggestions for a document and apply them in one step. Returns what was changed.",
    {
      id: z.number().describe("Document ID"),
      apply_correspondent: z.boolean().optional().describe("Apply suggested correspondent (default true)"),
      apply_document_type: z.boolean().optional().describe("Apply suggested document type (default true)"),
      apply_tags: z.boolean().optional().describe("Apply suggested tags (default true)"),
      apply_storage_path: z.boolean().optional().describe("Apply suggested storage path (default true)"),
    },
    async ({ id, apply_correspondent, apply_document_type, apply_tags, apply_storage_path }) => {
      try {
        const [suggestions, doc] = await Promise.all([
          client.fetch(`/api/documents/${id}/suggestions/`) as Promise<Suggestion>,
          client.fetch(`/api/documents/${id}/`) as Promise<Document>,
        ]);
        const updates: Record<string, unknown> = {};

        if ((apply_correspondent ?? true) && suggestions.correspondents?.length > 0) {
          updates.correspondent = suggestions.correspondents[0];
        }
        if ((apply_document_type ?? true) && suggestions.document_types?.length > 0) {
          updates.document_type = suggestions.document_types[0];
        }
        if ((apply_tags ?? true) && suggestions.tags?.length > 0) {
          const merged = [...new Set([...doc.tags, ...suggestions.tags])];
          updates.tags = merged;
        }
        if ((apply_storage_path ?? true) && suggestions.storage_paths?.length > 0) {
          updates.storage_path = suggestions.storage_paths[0];
        }

        if (Object.keys(updates).length === 0) {
          return ok({ id, message: "No suggestions available", suggestions });
        }

        const updated = await client.fetch(`/api/documents/${id}/`, {
          method: "PATCH",
          body: JSON.stringify(updates),
        });

        return ok({ id, applied: updates, suggestions, updated_document: updated });
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    "process_inbox",
    "Review all inbox documents and return proposed classifications. Does NOT apply changes — returns a plan for review.",
    {
      limit: z.number().optional().describe("Max documents to process (default 20)"),
    },
    async ({ limit }) => {
      try {
        const maxDocs = limit || 20;
        const data = await client.fetch(`/api/documents/${buildQS({ is_in_inbox: true, page_size: maxDocs })}`) as PaginatedResponse<Document>;
        const proposals: unknown[] = [];

        for (const doc of data.results) {
          try {
            const suggestions = await client.fetch(`/api/documents/${doc.id}/suggestions/`) as Suggestion;
            proposals.push({
              id: doc.id,
              title: doc.title,
              current: {
                correspondent: doc.correspondent,
                document_type: doc.document_type,
                tags: doc.tags,
                storage_path: doc.storage_path,
              },
              suggested: {
                correspondent: suggestions.correspondents?.[0] ?? null,
                document_type: suggestions.document_types?.[0] ?? null,
                tags: suggestions.tags ?? [],
                storage_path: suggestions.storage_paths?.[0] ?? null,
              },
            });
          } catch (e) {
            proposals.push({ id: doc.id, title: doc.title, error: String(e) });
          }
        }

        return ok({
          total_inbox: data.count,
          processed: proposals.length,
          proposals,
          note: "Use auto_classify_document or update_document to apply changes.",
        });
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    "bulk_tag_by_content",
    "Search for documents matching a query and add a tag to all results",
    {
      query: z.string().describe("Search query to find matching documents"),
      tag_id: z.number().describe("Tag ID to add to matching documents"),
      dry_run: z.boolean().optional().describe("If true, only return matching documents without tagging"),
    },
    async ({ query, tag_id, dry_run }) => {
      try {
        const data = await client.fetch(`/api/documents/${buildQS({ query, page_size: 100 })}`) as PaginatedResponse<Document>;
        const docIds = data.results.map(d => d.id);

        if (dry_run) {
          return ok({
            query,
            tag_id,
            matching_documents: data.results.map(d => ({ id: d.id, title: d.title })),
            count: docIds.length,
            total_matches: data.count,
            note: "Dry run — no changes made. Set dry_run to false to apply.",
          });
        }

        if (docIds.length === 0) {
          return ok({ query, tag_id, message: "No documents matched the query" });
        }

        const result = await client.fetch("/api/documents/bulk_edit/", {
          method: "POST",
          body: JSON.stringify({
            documents: docIds,
            method: "add_tag",
            parameters: { tag: tag_id },
          }),
        });

        return ok({
          query,
          tag_id,
          tagged_count: docIds.length,
          total_matches: data.count,
          result,
          note: data.count > 100 ? `Only tagged first 100 of ${data.count} matches. Run again to tag more.` : undefined,
        });
      } catch (e) { return err(e); }
    },
  );
}
