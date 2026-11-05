import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaperlessClient } from "../paperless/client.js";

const LISTS: { name: string; path: string; description: string; fields: string[] }[] = [
  {
    name: "tags",
    path: "/api/tags/",
    description: "All tags (id, name, color, inbox flag, parent, document count)",
    fields: ["id", "name", "color", "is_inbox_tag", "parent", "document_count"],
  },
  {
    name: "correspondents",
    path: "/api/correspondents/",
    description: "All correspondents (id, name, document count, last correspondence)",
    fields: ["id", "name", "document_count", "last_correspondence"],
  },
  {
    name: "document-types",
    path: "/api/document_types/",
    description: "All document types (id, name, document count)",
    fields: ["id", "name", "document_count"],
  },
  {
    name: "storage-paths",
    path: "/api/storage_paths/",
    description: "All storage paths (id, name, path template, document count)",
    fields: ["id", "name", "path", "document_count"],
  },
  {
    name: "custom-fields",
    path: "/api/custom_fields/",
    description: "All custom fields (id, name, data type, extra data such as select options)",
    fields: ["id", "name", "data_type", "extra_data", "document_count"],
  },
  {
    name: "saved-views",
    path: "/api/saved_views/",
    description: "All saved views (id, name, filter rules, sort order)",
    fields: ["id", "name", "filter_rules", "sort_field", "sort_reverse"],
  },
];

function pick(obj: Record<string, unknown>, fields: string[]) {
  return Object.fromEntries(fields.filter((f) => f in obj).map((f) => [f, obj[f]]));
}

function json(uri: URL, data: unknown) {
  return {
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }],
  };
}

export function registerResources(server: McpServer, client: PaperlessClient) {
  for (const { name, path, description, fields } of LISTS) {
    server.registerResource(
      name,
      `paperless://${name}`,
      { description, mimeType: "application/json" },
      async (uri) => {
        const items = await client.fetchAllPages<Record<string, unknown>>(path);
        return json(
          uri,
          items.map((i) => pick(i, fields)),
        );
      },
    );
  }

  server.registerResource(
    "document",
    new ResourceTemplate("paperless://documents/{id}", { list: undefined }),
    {
      description: "A single document's metadata plus its OCR text content",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      const docId = String(id);
      if (!/^\d+$/.test(docId)) throw new Error(`Invalid document id: ${docId}`);
      return json(uri, await client.fetch(`/api/documents/${docId}/`));
    },
  );
}
