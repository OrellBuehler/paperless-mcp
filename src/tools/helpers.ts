import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildQS, ok, err } from "../paperless/format.js";
import type { PaginatedResponse } from "../paperless/format.js";
import type { PaperlessClient } from "../paperless/client.js";

interface Correspondent {
  id: number;
  name: string;
  document_count: number;
}

interface Document {
  id: number;
  title: string;
  correspondent: number | null;
  document_type: number | null;
  tags: number[];
  created: string;
  added: string;
  archive_serial_number: number | null;
}

export function registerHelperTools(server: McpServer, client: PaperlessClient) {
  server.tool(
    "get_document_content",
    "Get the text content of a document (OCR'd text for PDFs, raw text for text files)",
    {
      id: z.number().describe("Document ID"),
      max_length: z.number().optional().describe("Truncate content to this many characters"),
    },
    async ({ id, max_length }) => {
      try {
        let content = await client.getDocumentContent(id);
        if (!content) {
          const doc = (await client.fetch(`/api/documents/${id}/`)) as { content: string };
          content = doc.content || "";
        }
        if (!content)
          return ok({ id, content: "", note: "No text content available for this document" });
        if (max_length && content.length > max_length) {
          content =
            content.slice(0, max_length) +
            `\n\n[Truncated at ${max_length} characters, total: ${content.length}]`;
        }
        return ok({ id, length: content.length, content });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_documents",
    "Get full details (including OCR text content) for one or more documents by ID. Use this after list_documents/search_documents, which return metadata only.",
    {
      ids: z.array(z.number()).describe("Document IDs to fetch in full"),
      max_content_length: z
        .number()
        .optional()
        .describe("Truncate each document's content to this many characters"),
    },
    async ({ ids, max_content_length }) => {
      try {
        const docs = await Promise.all(
          ids.map(
            (id) => client.fetch(`/api/documents/${id}/`) as Promise<Record<string, unknown>>,
          ),
        );
        const result = docs.map((doc) => {
          if (
            max_content_length &&
            typeof doc.content === "string" &&
            doc.content.length > max_content_length
          ) {
            return {
              ...doc,
              content: doc.content.slice(0, max_content_length),
              content_length: doc.content.length,
              content_truncated: true,
            };
          }
          return doc;
        });
        return ok(result);
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_documents_by_correspondent",
    "Find a correspondent by name and list their documents",
    {
      name: z.string().describe("Correspondent name (partial match)"),
      page: z.number().optional(),
      page_size: z.number().optional(),
    },
    async ({ name, page, page_size }) => {
      try {
        const corrs = (await client.fetch(
          `/api/correspondents/${buildQS({ name__icontains: name })}`,
        )) as PaginatedResponse<Correspondent>;
        if (corrs.results.length === 0) {
          return ok({ query: name, message: "No correspondents found matching that name" });
        }

        const correspondent = corrs.results[0];
        const docs = (await client.fetch(
          `/api/documents/${buildQS({
            correspondent__id: correspondent.id,
            page: page || 1,
            page_size: page_size || 25,
            ordering: "-created",
          })}`,
        )) as PaginatedResponse<Document>;

        return ok({
          correspondent: {
            id: correspondent.id,
            name: correspondent.name,
            document_count: correspondent.document_count,
          },
          other_matches:
            corrs.results.length > 1
              ? corrs.results.slice(1).map((c) => ({ id: c.id, name: c.name }))
              : undefined,
          documents: docs,
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "monthly_summary",
    "Get a summary of documents added or created in a given month",
    {
      year: z.number().describe("Year (e.g. 2024)"),
      month: z.number().describe("Month (1-12)"),
    },
    async ({ year, month }) => {
      try {
        const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
        const endMonth = month === 12 ? 1 : month + 1;
        const endYear = month === 12 ? year + 1 : year;
        const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

        const allDocs = await client.fetchAllPages<Document>(
          `/api/documents/${buildQS({
            added__date__gte: startDate,
            added__date__lt: endDate,
            ordering: "-added",
          })}`,
        );

        const byType: Record<string, number> = {};
        const byCorrespondent: Record<string, number> = {};
        for (const doc of allDocs) {
          const typeKey = doc.document_type ? String(doc.document_type) : "unclassified";
          byType[typeKey] = (byType[typeKey] || 0) + 1;
          const corrKey = doc.correspondent ? String(doc.correspondent) : "unknown";
          byCorrespondent[corrKey] = (byCorrespondent[corrKey] || 0) + 1;
        }

        return ok({
          period: `${year}-${String(month).padStart(2, "0")}`,
          total_added: allDocs.length,
          by_document_type_id: byType,
          by_correspondent_id: byCorrespondent,
          documents: allDocs.map((d) => ({
            id: d.id,
            title: d.title,
            created: d.created,
            added: d.added,
            correspondent: d.correspondent,
            document_type: d.document_type,
          })),
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "yearly_document_check",
    "Compare documents of a year against the previous year, grouped by correspondent + document type. Lists combinations present last year but missing this year — useful for spotting missing recurring documents (salary certificate, bank tax statement, insurance summary) when preparing a tax report.",
    {
      year: z.number().describe("Year to check (e.g. 2025), compared against the previous year"),
      tags__id__all: z
        .array(z.number())
        .optional()
        .describe("Only consider documents with ALL these tags"),
    },
    async ({ year, tags__id__all }) => {
      try {
        const fetchYear = (y: number) =>
          client.fetchAllPages<Document>(
            `/api/documents/${buildQS({
              created__date__gte: `${y}-01-01`,
              created__date__lt: `${y + 1}-01-01`,
              tags__id__all,
            })}`,
          );
        const [current, previous, corrs, types] = await Promise.all([
          fetchYear(year),
          fetchYear(year - 1),
          client.fetchAllPages<Correspondent>("/api/correspondents/"),
          client.fetchAllPages<Correspondent>("/api/document_types/"),
        ]);

        const corrNames = new Map(corrs.map((c) => [c.id, c.name]));
        const typeNames = new Map(types.map((t) => [t.id, t.name]));
        const describe = (doc: Document) => ({
          correspondent: doc.correspondent,
          correspondent_name: doc.correspondent ? corrNames.get(doc.correspondent) : null,
          document_type: doc.document_type,
          document_type_name: doc.document_type ? typeNames.get(doc.document_type) : null,
        });

        const groupByCombo = (docs: Document[]) => {
          const groups = new Map<
            string,
            ReturnType<typeof describe> & { count: number; titles: string[] }
          >();
          for (const doc of docs) {
            const key = `${doc.correspondent ?? "none"}|${doc.document_type ?? "none"}`;
            const group = groups.get(key);
            if (group) {
              group.count++;
              if (group.titles.length < 3) group.titles.push(doc.title);
            } else {
              groups.set(key, { ...describe(doc), count: 1, titles: [doc.title] });
            }
          }
          return groups;
        };

        const currentGroups = groupByCombo(current);
        const previousGroups = groupByCombo(previous);
        const missing = [...previousGroups.entries()]
          .filter(([key]) => !currentGroups.has(key))
          .map(([, { titles, ...group }]) => ({
            ...group,
            example_titles_from_previous_year: titles,
          }));
        const added = [...currentGroups.entries()]
          .filter(([key]) => !previousGroups.has(key))
          .map(([, { titles, ...group }]) => ({ ...group, example_titles: titles }));

        return ok({
          year,
          previous_year: year - 1,
          total_documents: { [year]: current.length, [year - 1]: previous.length },
          missing_this_year: missing,
          new_this_year: added,
          combos_in_both: [...previousGroups.keys()].filter((k) => currentGroups.has(k)).length,
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "upload_from_url",
    "Download a file from a URL and upload it to Paperless-ngx",
    {
      url: z.string().describe("URL to download the file from"),
      title: z.string().optional(),
      correspondent: z.number().optional(),
      document_type: z.number().optional(),
      storage_path: z.number().optional(),
      tags: z.array(z.number()).optional(),
    },
    async ({ url, title, correspondent, document_type, storage_path, tags }) => {
      try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          throw new Error(
            `Unsupported URL scheme: ${parsed.protocol}. Only http and https are allowed.`,
          );
        }
        const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100 MB
        const fileRes = await fetch(url, { redirect: "error" });
        if (!fileRes.ok)
          throw new Error(`Failed to download: ${fileRes.status} ${fileRes.statusText}`);
        const contentLength = parseInt(fileRes.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_DOWNLOAD_SIZE) {
          throw new Error(`File too large: ${contentLength} bytes (max ${MAX_DOWNLOAD_SIZE})`);
        }

        const contentDisposition = fileRes.headers.get("content-disposition");
        let filename = url.split("/").pop()?.split("?")[0] || "document";
        if (contentDisposition) {
          const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          if (match) filename = match[1].replace(/['"]/g, "");
        }

        const blob = await fileRes.blob();
        const form = new FormData();
        form.append("document", blob, filename);
        if (title !== undefined) form.append("title", title);
        if (correspondent !== undefined) form.append("correspondent", String(correspondent));
        if (document_type !== undefined) form.append("document_type", String(document_type));
        if (storage_path !== undefined) form.append("storage_path", String(storage_path));
        if (tags) tags.forEach((t) => form.append("tags", String(t)));

        const res = await client.upload("/api/documents/post_document/", form);
        if (!res.ok) throw new Error(`Upload failed: ${res.status}: ${await res.text()}`);

        return ok(
          await res.json().catch(() => ({
            status: "accepted",
            task: res.headers.get("location"),
            filename,
            source_url: url,
          })),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
}
