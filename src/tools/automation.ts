import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildQS, ok, err } from "../paperless/format.js";
import type { PaperlessClient } from "../paperless/client.js";

const triggersSchema = z
  .array(z.record(z.unknown()))
  .optional()
  .describe(
    "Workflow triggers. Each object: { type: 1=consumption | 2=document added | 3=document updated | 4=scheduled | " +
      "5=manual (runs only on demand via run_workflow, Paperless-ngx 3.5+); " +
      "sources?: number[] (1=consume folder, 2=api upload, 3=mail fetch, 4=web ui); filter_filename?; filter_path?; " +
      "filter_has_tags?: number[]; filter_has_correspondent?: number; filter_has_document_type?: number; " +
      "filter_custom_field_query?: string (JSON); matching_algorithm?: number; match?: string; " +
      "scheduled only: schedule_date_field?: added|created|modified|custom_field, schedule_date_custom_field?: number, " +
      "schedule_offset_days?: number, schedule_is_recurring?: boolean, schedule_recurring_interval_days?: number }",
  );

const actionsSchema = z
  .array(z.record(z.unknown()))
  .optional()
  .describe(
    "Workflow actions. Each object: { type: 1=assignment | 2=removal | 3=email | 4=webhook | " +
      "5=password removal (passwords: string[], 3.0+) | 6=move to trash (3.0+) | " +
      "7=remote OCR (needs a consumption trigger, 3.1+) | " +
      "8=apply AI suggestions (needs a trigger other than consumption, 3.1+; ai_suggestion_fields: (title|tags|correspondent|document_type|storage_path|created)[], ai_create_missing?: boolean, ai_overwrite_existing?: boolean); " +
      "assign_title? (Jinja template, e.g. {{ correspondent }}; {{ custom_fields.Name.value }} needs 3.4+); assign_tags?: number[]; assign_correspondent?: number; assign_document_type?: number; " +
      "assign_storage_path?: number; assign_owner?: number; remove_tags?: number[]; email?: object; webhook?: object }",
  );

export function registerAutomationTools(server: McpServer, client: PaperlessClient) {
  server.tool(
    "list_workflows",
    "List all Paperless workflows (document automation; replaces the old consumption templates)",
    {
      page: z.number().optional(),
      page_size: z.number().optional(),
      trigger_type: z
        .number()
        .optional()
        .describe(
          "Only workflows with a trigger of this type (1=consumption, 2=added, 3=updated, 4=scheduled, 5=manual). Paperless-ngx 3.5+",
        ),
      enabled: z.boolean().optional().describe("Filter by enabled state. Paperless-ngx 3.5+"),
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

  server.tool(
    "run_workflow",
    "Manually run a workflow on existing documents. The workflow must be enabled and have a manual trigger (type 5); find candidates with list_workflows (trigger_type 5). Requires Paperless-ngx 3.5+. You need view permission on workflows and must own the documents (or they must be unowned). The workflow runs in the background and the response contains a task_id; check it with list_tasks.",
    {
      documents: z.array(z.number()).min(1).describe("Document IDs"),
      workflow: z.number().describe("Workflow ID"),
      filter_documents: z
        .boolean()
        .optional()
        .describe(
          "Apply the workflow's trigger filters and skip documents that do not match (server default true). Pass false to run it on every given document regardless of the filters",
        ),
    },
    async ({ documents, workflow, filter_documents }) => {
      try {
        const parameters: Record<string, unknown> = { workflow };
        if (filter_documents !== undefined) parameters.filter_documents = filter_documents;
        return ok(
          await client.fetch("/api/documents/bulk_edit/", {
            method: "POST",
            body: JSON.stringify({ documents, method: "run_workflow", parameters }),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
}
