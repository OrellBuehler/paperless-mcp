import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { extractText } from "unpdf";
import { ok, err, buildQS } from "../paperless/format.js";
import type { PaperlessClient } from "../paperless/client.js";

const docSelection = {
  documents: z.array(z.number()).optional().describe("Explicit document IDs"),
  all: z
    .boolean()
    .optional()
    .describe("Apply to every document matching `filters` instead of a list"),
  filters: z
    .record(z.unknown())
    .optional()
    .describe("Filter object used when `all` is true, e.g. { tags__id__all: [3] }"),
};

export function registerDocumentTools(server: McpServer, client: PaperlessClient) {
  server.tool(
    "get_document_history",
    "Get a document's audit trail: who changed which field, and when",
    { id: z.number().describe("Document ID") },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/documents/${id}/history/`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_document_ai_suggestions",
    "Get LLM-generated suggestions for a document (title, tags, correspondent, dates). Requires Paperless-ngx 3.0+ with an AI backend configured.",
    { id: z.number().describe("Document ID") },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/documents/${id}/ai_suggestions/`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_document_root",
    "Get the root document ID for a document version. Requires Paperless-ngx 3.0+.",
    { id: z.number().describe("Document ID") },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/documents/${id}/root/`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "upload_document_version",
    "Upload a new file version of an existing document, keeping its metadata and history. Requires Paperless-ngx 3.0+.",
    {
      id: z.number().describe("Document ID"),
      file_path: z.string().describe("Absolute path to the replacement file on disk"),
      version_label: z.string().optional().describe("Human-readable label for this version"),
    },
    async ({ id, file_path, version_label }) => {
      try {
        const fileData = await readFile(file_path);
        const filename = file_path.split("/").pop() || "document";
        const form = new FormData();
        form.append("document", new Blob([fileData]), filename);
        if (version_label !== undefined) form.append("version_label", version_label);
        const res = await client.upload(`/api/documents/${id}/update_version/`, form);
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        return ok(await res.json().catch(() => ({ status: "accepted" })));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "set_document_version_label",
    "Rename one version of a document. Requires Paperless-ngx 3.0+.",
    {
      id: z.number().describe("Document ID"),
      version_id: z.number().describe("Version ID"),
      version_label: z.string().describe("New label; pass an empty string to clear it"),
    },
    async ({ id, version_id, version_label }) => {
      try {
        return ok(
          await client.fetch(`/api/documents/${id}/versions/${version_id}/`, {
            method: "PATCH",
            body: JSON.stringify({ version_label }),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "delete_document_version",
    "Delete one version of a document. The root version cannot be deleted. Requires Paperless-ngx 3.0+.",
    {
      id: z.number().describe("Document ID"),
      version_id: z.number().describe("Version ID"),
    },
    async ({ id, version_id }) => {
      try {
        return ok(
          await client.fetch(`/api/documents/${id}/versions/${version_id}/`, { method: "DELETE" }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_selection_data",
    "Get tag, correspondent and document type counts across a set of documents. Useful for deciding a bulk edit before running it.",
    { documents: z.array(z.number()).describe("Document IDs") },
    async ({ documents }) => {
      try {
        return ok(
          await client.fetch("/api/documents/selection_data/", {
            method: "POST",
            body: JSON.stringify({ documents }),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "bulk_download_documents",
    "Download several documents as a single zip archive written to disk",
    {
      documents: z.array(z.number()).describe("Document IDs"),
      output_path: z.string().describe("Absolute path to write the .zip file to"),
      content: z
        .enum(["archive", "originals", "both"])
        .optional()
        .describe("Which file versions to include"),
      compression: z.enum(["none", "deflated", "bzip2", "lzma"]).optional(),
      follow_formatting: z
        .boolean()
        .optional()
        .describe("Lay the zip out using the storage path filename format"),
    },
    async ({ documents, output_path, content, compression, follow_formatting }) => {
      try {
        const res = await client.download("/api/documents/bulk_download/", {
          method: "POST",
          body: JSON.stringify({ documents, content, compression, follow_formatting }),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(output_path, buf);
        return ok({ path: output_path, bytes: buf.byteLength, documents: documents.length });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "extract_document_pages",
    "Extract pages from a document's PDF into a new PDF written to disk. Processes the file locally; the document in Paperless is not modified.",
    {
      id: z.number().describe("Document ID"),
      pages: z.array(z.number()).min(1).describe("1-based page numbers, kept in the given order"),
      output_path: z.string().describe("Absolute path to write the extracted .pdf to"),
      original: z
        .boolean()
        .optional()
        .describe("Use the original file instead of the archived version"),
    },
    async ({ id, pages, output_path, original }) => {
      try {
        const res = await client.download(`/api/documents/${id}/download/${buildQS({ original })}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("pdf")) throw new Error(`document is not a PDF (content-type: ${ct})`);
        const src = await PDFDocument.load(await res.arrayBuffer());
        const total = src.getPageCount();
        const outOfRange = pages.filter((p) => p < 1 || p > total);
        if (outOfRange.length)
          throw new Error(
            `pages out of range: ${outOfRange.join(", ")} (document has ${total} pages)`,
          );
        const out = await PDFDocument.create();
        const copied = await out.copyPages(
          src,
          pages.map((p) => p - 1),
        );
        for (const page of copied) out.addPage(page);
        const bytes = await out.save();
        await writeFile(output_path, bytes);
        return ok({ path: output_path, pages, total_pages: total, bytes: bytes.byteLength });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "find_document_pages",
    "Find which pages of a document's PDF contain a text snippet. Searches the PDF text layer locally (scanned documents need an OCR'd archive version). Pair with extract_document_pages to pull out the matching pages.",
    {
      id: z.number().describe("Document ID"),
      query: z.string().describe("Text to search for (case-insensitive)"),
      original: z
        .boolean()
        .optional()
        .describe("Search the original file instead of the archived version"),
    },
    async ({ id, query, original }) => {
      try {
        const res = await client.download(`/api/documents/${id}/download/${buildQS({ original })}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("pdf")) throw new Error(`document is not a PDF (content-type: ${ct})`);
        const { totalPages, text } = await extractText(new Uint8Array(await res.arrayBuffer()));
        const normalize = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
        const needle = normalize(query);
        const matches = text.flatMap((pageText, i) => {
          const hay = normalize(pageText);
          const idx = hay.indexOf(needle);
          if (idx === -1) return [];
          const start = Math.max(0, idx - 80);
          const snippet = hay.slice(start, idx + needle.length + 80).trim();
          return [{ page: i + 1, snippet }];
        });
        return ok({ query, total_pages: totalPages, matches });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "test_storage_path",
    "Preview the filename a storage path template produces for a document, without saving anything",
    {
      path: z
        .string()
        .describe("Storage path template, e.g. {created_year}/{correspondent}/{title}"),
      document: z.number().describe("Document ID to render the template against"),
    },
    async (body) => {
      try {
        return ok(
          await client.fetch("/api/storage_paths/test/", {
            method: "POST",
            body: JSON.stringify(body),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "rotate_documents",
    "Rotate documents by a multiple of 90 degrees. Requires Paperless-ngx 3.0+ (use bulk_edit_documents on older servers).",
    {
      ...docSelection,
      degrees: z.number().describe("Rotation in degrees; must be a multiple of 90"),
    },
    async (body) => {
      try {
        return ok(
          await client.fetch("/api/documents/rotate/", {
            method: "POST",
            body: JSON.stringify(body),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "merge_documents",
    "Merge several documents into one new document. Requires Paperless-ngx 3.0+ (use bulk_edit_documents on older servers).",
    {
      documents: z.array(z.number()).describe("Document IDs, merged in this order"),
      metadata_document_id: z
        .number()
        .optional()
        .describe("Copy metadata from this document onto the merged result"),
      delete_originals: z.boolean().optional(),
      archive_fallback: z
        .boolean()
        .optional()
        .describe("Use the archived version when an original is not a PDF"),
    },
    async (body) => {
      try {
        return ok(
          await client.fetch("/api/documents/merge/", {
            method: "POST",
            body: JSON.stringify(body),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "edit_pdf_document",
    "Reorder, rotate, split or delete pages of a document. Requires Paperless-ngx 3.0+.",
    {
      documents: z.array(z.number()).describe("Document IDs (normally exactly one)"),
      operations: z
        .array(z.record(z.unknown()))
        .describe(
          "Page operations. Each object: { page: number (1-based source page), rotate?: 0|90|180|270, doc?: number (output document index for splitting) }. Omit a page to delete it.",
        ),
      delete_original: z.boolean().optional(),
      update_document: z
        .boolean()
        .optional()
        .describe("Update the existing document in place instead of creating a new one"),
      include_metadata: z.boolean().optional(),
    },
    async (body) => {
      try {
        return ok(
          await client.fetch("/api/documents/edit_pdf/", {
            method: "POST",
            body: JSON.stringify(body),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "remove_document_password",
    "Strip password protection from encrypted PDFs. Requires Paperless-ngx 3.0+.",
    {
      documents: z.array(z.number()).describe("Document IDs"),
      password: z.string().describe("Password that unlocks the PDFs"),
      update_document: z.boolean().optional(),
      delete_original: z.boolean().optional(),
      include_metadata: z.boolean().optional(),
    },
    async (body) => {
      try {
        return ok(
          await client.fetch("/api/documents/remove_password/", {
            method: "POST",
            body: JSON.stringify(body),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "reprocess_documents",
    "Re-run OCR and archive generation for documents. Requires Paperless-ngx 3.0+ (use bulk_edit_documents on older servers).",
    docSelection,
    async (body) => {
      try {
        return ok(
          await client.fetch("/api/documents/reprocess/", {
            method: "POST",
            body: JSON.stringify(body),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
}
