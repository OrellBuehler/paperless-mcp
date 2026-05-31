import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildQS, ok, err } from "../paperless/format.js";
import type { PaperlessClient } from "../paperless/client.js";

const triggersSchema = z
  .array(z.record(z.unknown()))
  .optional()
  .describe(
    "Workflow triggers. Each object: { type: 1=consumption | 2=document added | 3=document updated; " +
      "sources?: number[] (1=consume folder, 2=api upload, 3=mail fetch); filter_filename?; filter_path?; " +
      "filter_has_tags?: number[]; filter_has_correspondent?: number; filter_has_document_type?: number; " +
      "matching_algorithm?: number; match?: string }",
  );

const actionsSchema = z
  .array(z.record(z.unknown()))
  .optional()
  .describe(
    "Workflow actions. Each object: { type: 1=assignment | 2=removal | 3=email | 4=webhook; " +
      "assign_title?; assign_tags?: number[]; assign_correspondent?: number; assign_document_type?: number; " +
      "assign_storage_path?: number; assign_owner?: number; remove_tags?: number[]; email?: object; webhook?: object }",
  );

export function registerAutomationTools(server: McpServer, client: PaperlessClient) {
  server.tool(
    "list_workflows",
    "List all Paperless workflows (document automation; replaces the old consumption templates)",
    {
      page: z.number().optional(),
      page_size: z.number().optional(),
    },
    async (params) => {
      try {
        return ok(await client.fetch(`/api/workflows/${buildQS(params)}`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_workflow",
    "Get a single workflow by ID, including its triggers and actions",
    { id: z.number() },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/workflows/${id}/`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "create_workflow",
    "Create a new workflow with inline triggers and actions",
    {
      name: z.string(),
      order: z.number().optional(),
      enabled: z.boolean().optional(),
      triggers: triggersSchema,
      actions: actionsSchema,
    },
    async (body) => {
      try {
        return ok(
          await client.fetch("/api/workflows/", {
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
    "update_workflow",
    "Update an existing workflow (partial update)",
    {
      id: z.number(),
      name: z.string().optional(),
      order: z.number().optional(),
      enabled: z.boolean().optional(),
      triggers: triggersSchema,
      actions: actionsSchema,
    },
    async ({ id, ...body }) => {
      try {
        return ok(
          await client.fetch(`/api/workflows/${id}/`, {
            method: "PATCH",
            body: JSON.stringify(body),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
}
