import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { paperlessFetch, buildQS, ok, err, PAPERLESS_URL, PAPERLESS_TOKEN } from "../paperless.js";

export function registerCoreTools(server: McpServer) {
  // --- System ---

  server.tool("get_status", "Get Paperless-ngx server status", {}, async () => {
    try { return ok(await paperlessFetch("/api/status/")); }
    catch (e) { return err(e); }
  });

  server.tool("get_statistics", "Get document statistics (total count, inbox count, etc.)", {}, async () => {
    try { return ok(await paperlessFetch("/api/statistics/")); }
    catch (e) { return err(e); }
  });

  server.tool("list_tasks", "List background tasks (consumption, etc.)", {}, async () => {
    try { return ok(await paperlessFetch("/api/tasks/")); }
    catch (e) { return err(e); }
  });

  // --- Search ---

  server.tool(
    "search_documents",
    "Full-text search across all documents",
    {
      query: z.string().describe("Search query"),
      db_only: z.boolean().optional().describe("Search database only, skip full-text index"),
    },
    async ({ query, db_only }) => {
      try { return ok(await paperlessFetch(`/api/search/${buildQS({ query, db_only })}`)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    "search_autocomplete",
    "Get autocomplete suggestions for a search term",
    {
      term: z.string().describe("Partial search term"),
      limit: z.number().optional(),
    },
    async ({ term, limit }) => {
      try { return ok(await paperlessFetch(`/api/search/autocomplete/${buildQS({ term, limit })}`)); }
      catch (e) { return err(e); }
    },
  );

  // --- Documents ---

  server.tool(
    "list_documents",
    "List documents with optional filtering, searching and pagination",
    {
      page: z.number().optional(),
      page_size: z.number().optional(),
      query: z.string().optional().describe("Full-text search query"),
      title__icontains: z.string().optional(),
      correspondent__id: z.number().optional(),
      document_type__id: z.number().optional(),
      storage_path__id: z.number().optional(),
      tags__id__all: z.array(z.number()).optional().describe("Must have ALL these tags"),
      tags__id__in: z.array(z.number()).optional().describe("Must have at least one of these tags"),
      is_in_inbox: z.boolean().optional(),
      created__date__gt: z.string().optional().describe("Created after (YYYY-MM-DD)"),
      created__date__lt: z.string().optional().describe("Created before (YYYY-MM-DD)"),
      added__date__gt: z.string().optional().describe("Added after (YYYY-MM-DD)"),
      added__date__lt: z.string().optional().describe("Added before (YYYY-MM-DD)"),
      ordering: z.string().optional().describe("Field to order by, prefix with - for descending"),
    },
    async (params) => {
      try { return ok(await paperlessFetch(`/api/documents/${buildQS(params)}`)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    "get_document",
    "Get a single document by ID",
    { id: z.number().describe("Document ID") },
    async ({ id }) => {
      try { return ok(await paperlessFetch(`/api/documents/${id}/`)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    "download_document",
    "Download a document's content as text (only works for text-based documents)",
    {
      id: z.number().describe("Document ID"),
      original: z.boolean().optional().describe("Download original instead of archived version"),
    },
    async ({ id, original }) => {
      try {
        const url = `${PAPERLESS_URL}/api/documents/${id}/download/${buildQS({ original })}`;
        const res = await fetch(url, {
          headers: { Authorization: `Token ${PAPERLESS_TOKEN}` },
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("text") || ct.includes("json") || ct.includes("xml")) {
          return ok({ content_type: ct, content: await res.text() });
        }
        const buf = await res.arrayBuffer();
        return ok({ content_type: ct, size: buf.byteLength, note: "Binary file, content not shown. Use the Paperless web UI to view this document." });
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    "update_document",
    "Update a document's metadata",
    {
      id: z.number().describe("Document ID"),
      title: z.string().optional(),
      correspondent: z.number().nullable().optional().describe("Correspondent ID or null to clear"),
      document_type: z.number().nullable().optional().describe("Document type ID or null to clear"),
      storage_path: z.number().nullable().optional().describe("Storage path ID or null to clear"),
      tags: z.array(z.number()).optional().describe("Replace all tags with these IDs"),
      archive_serial_number: z.number().nullable().optional(),
      created: z.string().optional().describe("Created date (YYYY-MM-DD)"),
      custom_fields: z.array(z.object({ field: z.number(), value: z.unknown() })).optional(),
    },
    async ({ id, ...body }) => {
      try {
        return ok(await paperlessFetch(`/api/documents/${id}/`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    "delete_document",
    "Delete a document",
    { id: z.number().describe("Document ID") },
    async ({ id }) => {
      try { return ok(await paperlessFetch(`/api/documents/${id}/`, { method: "DELETE" })); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    "upload_document",
    "Upload a document from a local file path",
    {
      file_path: z.string().describe("Absolute path to the file on disk"),
      title: z.string().optional(),
      correspondent: z.number().optional(),
      document_type: z.number().optional(),
      storage_path: z.number().optional(),
      tags: z.array(z.number()).optional(),
      archive_serial_number: z.number().optional(),
      created: z.string().optional().describe("Created date (YYYY-MM-DD)"),
    },
    async ({ file_path, title, correspondent, document_type, storage_path, tags, archive_serial_number, created }) => {
      try {
        const fileData = await readFile(file_path);
        const filename = file_path.split("/").pop() || "document";
        const form = new FormData();
        form.append("document", new Blob([fileData]), filename);
        if (title !== undefined) form.append("title", title);
        if (correspondent !== undefined) form.append("correspondent", String(correspondent));
        if (document_type !== undefined) form.append("document_type", String(document_type));
        if (storage_path !== undefined) form.append("storage_path", String(storage_path));
        if (archive_serial_number !== undefined) form.append("archive_serial_number", String(archive_serial_number));
        if (created !== undefined) form.append("created", created);
        if (tags) tags.forEach(t => form.append("tags", String(t)));

        const res = await fetch(`${PAPERLESS_URL}/api/documents/post_document/`, {
          method: "POST",
          headers: { Authorization: `Token ${PAPERLESS_TOKEN}` },
          body: form,
        });
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        return ok(await res.json().catch(() => ({ status: "accepted", task: res.headers.get("location") })));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    "get_document_metadata",
    "Get metadata (original filename, checksum, dates, etc.) for a document",
    { id: z.number().describe("Document ID") },
    async ({ id }) => {
      try { return ok(await paperlessFetch(`/api/documents/${id}/metadata/`)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    "get_document_suggestions",
    "Get AI-generated suggestions for correspondent, type, tags, and dates",
    { id: z.number().describe("Document ID") },
    async ({ id }) => {
      try { return ok(await paperlessFetch(`/api/documents/${id}/suggestions/`)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    "get_document_notes",
    "Get notes/comments on a document",
    { id: z.number().describe("Document ID") },
    async ({ id }) => {
      try { return ok(await paperlessFetch(`/api/documents/${id}/notes/`)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    "add_document_note",
    "Add a note/comment to a document",
    {
      id: z.number().describe("Document ID"),
      note: z.string().describe("Note text"),
    },
    async ({ id, note }) => {
      try {
        return ok(await paperlessFetch(`/api/documents/${id}/notes/`, {
          method: "POST",
          body: JSON.stringify({ note }),
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    "delete_document_note",
    "Delete a note from a document",
    {
      id: z.number().describe("Document ID"),
      note_id: z.number().describe("Note ID to delete"),
    },
    async ({ id, note_id }) => {
      try {
        return ok(await paperlessFetch(`/api/documents/${id}/notes/`, {
          method: "DELETE",
          body: JSON.stringify({ id: note_id }),
        }));
      } catch (e) { return err(e); }
    },
  );

  // --- Bulk Operations ---

  server.tool(
    "bulk_edit_documents",
    "Perform bulk operations on multiple documents (set tags, correspondent, type, delete, merge, etc.)",
    {
      documents: z.array(z.number()).describe("Array of document IDs"),
      method: z.string().describe("Operation: set_correspondent, set_document_type, set_storage_path, add_tag, remove_tag, modify_tags, delete, redo_ocr, reprocess, set_permissions, rotate, merge, split, convert"),
      parameters: z.record(z.unknown()).optional().describe("Operation-specific parameters"),
    },
    async ({ documents, method, parameters }) => {
      try {
        return ok(await paperlessFetch("/api/documents/bulk_edit/", {
          method: "POST",
          body: JSON.stringify({ documents, method, parameters: parameters || {} }),
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool("get_next_asn", "Get the next available archive serial number", {}, async () => {
    try { return ok(await paperlessFetch("/api/documents/next_asn/")); }
    catch (e) { return err(e); }
  });

  // --- Correspondents ---

  server.tool(
    "list_correspondents",
    "List all correspondents (senders/recipients)",
    {
      page: z.number().optional(),
      page_size: z.number().optional(),
      name__icontains: z.string().optional(),
      ordering: z.string().optional(),
    },
    async (params) => {
      try { return ok(await paperlessFetch(`/api/correspondents/${buildQS(params)}`)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    "get_correspondent",
    "Get a single correspondent by ID",
    { id: z.number() },
    async ({ id }) => {
      try { return ok(await paperlessFetch(`/api/correspondents/${id}/`)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    "create_correspondent",
    "Create a new correspondent",
    {
      name: z.string(),
      match: z.string().optional().describe("Auto-matching pattern"),
      matching_algorithm: z.number().optional().describe("1=any, 2=all, 3=literal, 4=regex, 5=fuzzy, 6=auto"),
      is_insensitive: z.boolean().optional(),
    },
    async (body) => {
      try {
        return ok(await paperlessFetch("/api/correspondents/", {
          method: "POST",
          body: JSON.stringify(body),
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    "delete_correspondent",
    "Delete a correspondent",
    { id: z.number() },
    async ({ id }) => {
      try { return ok(await paperlessFetch(`/api/correspondents/${id}/`, { method: "DELETE" })); }
      catch (e) { return err(e); }
    },
  );

  // --- Document Types ---

  server.tool(
    "list_document_types",
    "List all document types",
    {
      page: z.number().optional(),
      page_size: z.number().optional(),
      name__icontains: z.string().optional(),
      ordering: z.string().optional(),
    },
    async (params) => {
      try { return ok(await paperlessFetch(`/api/document_types/${buildQS(params)}`)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    "get_document_type",
    "Get a single document type by ID",
    { id: z.number() },
    async ({ id }) => {
      try { return ok(await paperlessFetch(`/api/document_types/${id}/`)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    "create_document_type",
    "Create a new document type",
    {
      name: z.string(),
      match: z.string().optional(),
      matching_algorithm: z.number().optional().describe("1=any, 2=all, 3=literal, 4=regex, 5=fuzzy, 6=auto"),
      is_insensitive: z.boolean().optional(),
    },
    async (body) => {
      try {
        return ok(await paperlessFetch("/api/document_types/", {
          method: "POST",
          body: JSON.stringify(body),
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    "delete_document_type",
    "Delete a document type",
    { id: z.number() },
    async ({ id }) => {
      try { return ok(await paperlessFetch(`/api/document_types/${id}/`, { method: "DELETE" })); }
      catch (e) { return err(e); }
    },
  );

  // --- Tags ---

  server.tool(
    "list_tags",
    "List all tags",
    {
      page: z.number().optional(),
      page_size: z.number().optional(),
      name__icontains: z.string().optional(),
      is_inbox_tag: z.boolean().optional(),
      ordering: z.string().optional(),
    },
    async (params) => {
      try { return ok(await paperlessFetch(`/api/tags/${buildQS(params)}`)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    "get_tag",
    "Get a single tag by ID",
    { id: z.number() },
    async ({ id }) => {
      try { return ok(await paperlessFetch(`/api/tags/${id}/`)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    "create_tag",
    "Create a new tag",
    {
      name: z.string(),
      color: z.string().optional().describe("Hex color like #ff0000"),
      is_inbox_tag: z.boolean().optional(),
      match: z.string().optional(),
      matching_algorithm: z.number().optional().describe("1=any, 2=all, 3=literal, 4=regex, 5=fuzzy, 6=auto"),
      is_insensitive: z.boolean().optional(),
    },
    async (body) => {
      try {
        return ok(await paperlessFetch("/api/tags/", {
          method: "POST",
          body: JSON.stringify(body),
        }));
      } catch (e) { return err(e); }
    },
  );

  server.tool(
    "delete_tag",
    "Delete a tag",
    { id: z.number() },
    async ({ id }) => {
      try { return ok(await paperlessFetch(`/api/tags/${id}/`, { method: "DELETE" })); }
      catch (e) { return err(e); }
    },
  );

  // --- Saved Views ---

  server.tool(
    "list_saved_views",
    "List all saved views",
    {
      page: z.number().optional(),
      page_size: z.number().optional(),
    },
    async (params) => {
      try { return ok(await paperlessFetch(`/api/saved_views/${buildQS(params)}`)); }
      catch (e) { return err(e); }
    },
  );

  server.tool(
    "get_saved_view",
    "Get a single saved view by ID",
    { id: z.number() },
    async ({ id }) => {
      try { return ok(await paperlessFetch(`/api/saved_views/${id}/`)); }
      catch (e) { return err(e); }
    },
  );

  // --- Storage Paths ---

  server.tool(
    "list_storage_paths",
    "List all storage paths",
    {
      page: z.number().optional(),
      page_size: z.number().optional(),
      name__icontains: z.string().optional(),
    },
    async (params) => {
      try { return ok(await paperlessFetch(`/api/storage_paths/${buildQS(params)}`)); }
      catch (e) { return err(e); }
    },
  );

  // --- Custom Fields ---

  server.tool(
    "list_custom_fields",
    "List all custom fields",
    {
      page: z.number().optional(),
      page_size: z.number().optional(),
    },
    async (params) => {
      try { return ok(await paperlessFetch(`/api/custom_fields/${buildQS(params)}`)); }
      catch (e) { return err(e); }
    },
  );
}
