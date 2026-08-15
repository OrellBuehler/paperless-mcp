import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildQS, ok, err } from "../paperless/format.js";
import type { PaperlessClient } from "../paperless/client.js";

export function registerSharingTools(server: McpServer, client: PaperlessClient) {
  server.tool(
    "list_share_links",
    "List public share links",
    { page: z.number().optional(), page_size: z.number().optional() },
    async (params) => {
      try {
        return ok(await client.fetch(`/api/share_links/${buildQS(params)}`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_share_link",
    "Get a single share link by ID",
    { id: z.number() },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/share_links/${id}/`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_document_share_links",
    "List all share links pointing at one document",
    { id: z.number().describe("Document ID") },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/documents/${id}/share_links/`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "create_share_link",
    "Create a public share link for a document. Anyone with the returned slug URL can read it.",
    {
      document: z.number().describe("Document ID"),
      expiration: z
        .string()
        .nullable()
        .optional()
        .describe("ISO 8601 datetime when the link stops working, or null for no expiry"),
      file_version: z
        .enum(["archive", "original"])
        .optional()
        .describe("Which file version the link serves"),
    },
    async (body) => {
      try {
        return ok(
          await client.fetch("/api/share_links/", { method: "POST", body: JSON.stringify(body) }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_share_link_bundles",
    "List share link bundles (one link serving a zip of several documents). Requires Paperless-ngx 3.0+.",
    { page: z.number().optional(), page_size: z.number().optional() },
    async (params) => {
      try {
        return ok(await client.fetch(`/api/share_link_bundles/${buildQS(params)}`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_share_link_bundle",
    "Get a single share link bundle by ID. Requires Paperless-ngx 3.0+.",
    { id: z.number() },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/share_link_bundles/${id}/`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "create_share_link_bundle",
    "Create a share link bundle serving several documents as one zip. Requires Paperless-ngx 3.0+.",
    {
      document_ids: z.array(z.number()).describe("Document IDs to include"),
      expiration_days: z.number().nullable().optional().describe("Days until the link expires"),
    },
    async (body) => {
      try {
        return ok(
          await client.fetch("/api/share_link_bundles/", {
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
    "rebuild_share_link_bundle",
    "Rebuild a share link bundle's zip after its documents changed. Requires Paperless-ngx 3.0+.",
    { id: z.number() },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/share_link_bundles/${id}/rebuild/`, { method: "POST" }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "email_document",
    "Email a single document as an attachment",
    {
      id: z.number().describe("Document ID"),
      addresses: z.string().describe("Comma-separated recipient email addresses"),
      subject: z.string(),
      message: z.string(),
      use_archive_version: z
        .boolean()
        .optional()
        .describe("Send the archived PDF instead of the original file"),
    },
    async ({ id, ...body }) => {
      try {
        return ok(
          await client.fetch(`/api/documents/${id}/email/`, {
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
    "email_documents",
    "Email several documents as attachments in one message",
    {
      documents: z.array(z.number()).describe("Document IDs"),
      addresses: z.string().describe("Comma-separated recipient email addresses"),
      subject: z.string(),
      message: z.string(),
      use_archive_version: z
        .boolean()
        .optional()
        .describe("Send the archived PDFs instead of the original files"),
    },
    async (body) => {
      try {
        return ok(
          await client.fetch("/api/documents/email/", {
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
