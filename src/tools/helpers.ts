import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { paperlessFetch, buildQS, getDocumentContent, ok, err, PAPERLESS_URL, PAPERLESS_TOKEN, PaginatedResponse } from "../paperless.js";

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

export function registerHelperTools(server: McpServer) {
  server.tool(
    "get_document_content",
    "Get the text content of a document (OCR'd text for PDFs, raw text for text files)",
    {
      id: z.number().describe("Document ID"),
      max_length: z.number().optional().describe("Truncate content to this many characters"),
    },
    async ({ id, max_length }) => {
      try {
        let content = await getDocumentContent(id);
        if (!content) {
          const doc = await paperlessFetch(`/api/documents/${id}/`) as { content: string };
          content = doc.content || "";
        }
        if (!content) return ok({ id, content: "", note: "No text content available for this document" });
        if (max_length && content.length > max_length) {
          content = content.slice(0, max_length) + `\n\n[Truncated at ${max_length} characters, total: ${content.length}]`;
        }
        return ok({ id, length: content.length, content });
      } catch (e) { return err(e); }
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
        const corrs = await paperlessFetch(`/api/correspondents/${buildQS({ name__icontains: name })}`) as PaginatedResponse<Correspondent>;
        if (corrs.results.length === 0) {
          return ok({ query: name, message: "No correspondents found matching that name" });
        }

        const correspondent = corrs.results[0];
        const docs = await paperlessFetch(`/api/documents/${buildQS({
          correspondent__id: correspondent.id,
          page: page || 1,
          page_size: page_size || 25,
          ordering: "-created",
        })}`) as PaginatedResponse<Document>;

        return ok({
          correspondent: { id: correspondent.id, name: correspondent.name, document_count: correspondent.document_count },
          other_matches: corrs.results.length > 1 ? corrs.results.slice(1).map(c => ({ id: c.id, name: c.name })) : undefined,
          documents: docs,
        });
      } catch (e) { return err(e); }
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

        const docs = await paperlessFetch(`/api/documents/${buildQS({
          added__date__gte: startDate,
          added__date__lt: endDate,
          page_size: 100,
          ordering: "-added",
        })}`) as PaginatedResponse<Document>;

        const byType: Record<string, number> = {};
        const byCorrespondent: Record<string, number> = {};
        for (const doc of docs.results) {
          const typeKey = doc.document_type ? String(doc.document_type) : "unclassified";
          byType[typeKey] = (byType[typeKey] || 0) + 1;
          const corrKey = doc.correspondent ? String(doc.correspondent) : "unknown";
          byCorrespondent[corrKey] = (byCorrespondent[corrKey] || 0) + 1;
        }

        return ok({
          period: `${year}-${String(month).padStart(2, "0")}`,
          total_added: docs.count,
          shown: docs.results.length,
          by_document_type_id: byType,
          by_correspondent_id: byCorrespondent,
          documents: docs.results.map(d => ({
            id: d.id,
            title: d.title,
            created: d.created,
            added: d.added,
            correspondent: d.correspondent,
            document_type: d.document_type,
          })),
        });
      } catch (e) { return err(e); }
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
          throw new Error(`Unsupported URL scheme: ${parsed.protocol}. Only http and https are allowed.`);
        }
        const fileRes = await fetch(url);
        if (!fileRes.ok) throw new Error(`Failed to download: ${fileRes.status} ${fileRes.statusText}`);

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
        if (tags) tags.forEach(t => form.append("tags", String(t)));

        const res = await fetch(`${PAPERLESS_URL}/api/documents/post_document/`, {
          method: "POST",
          headers: { Authorization: `Token ${PAPERLESS_TOKEN}` },
          body: form,
        });
        if (!res.ok) throw new Error(`Upload failed: ${res.status}: ${await res.text()}`);

        return ok(await res.json().catch(() => ({
          status: "accepted",
          task: res.headers.get("location"),
          filename,
          source_url: url,
        })));
      } catch (e) { return err(e); }
    },
  );
}
