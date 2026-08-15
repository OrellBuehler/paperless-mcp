import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildQS, ok, err } from "../paperless/format.js";
import type { PaperlessClient } from "../paperless/client.js";

export function registerSystemTools(server: McpServer, client: PaperlessClient) {
  server.tool(
    "get_config",
    "Get the Paperless application configuration (OCR and barcode settings)",
    {},
    async () => {
      try {
        return ok(await client.fetch("/api/config/"));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "update_config",
    "Update the Paperless application configuration (partial update). Affects OCR and barcode handling for future consumption.",
    {
      id: z.number().describe("Configuration ID, normally 1"),
      output_type: z.string().nullable().optional().describe("e.g. pdfa, pdf"),
      language: z.string().nullable().optional().describe("OCR language, e.g. deu or eng"),
      pages: z.number().nullable().optional().describe("Limit OCR to the first N pages"),
      mode: z
        .string()
        .nullable()
        .optional()
        .describe("OCR mode: skip, redo, force, skip_noarchive"),
      skip_archive_file: z.string().nullable().optional(),
      image_dpi: z.number().nullable().optional(),
      unpaper_clean: z.string().nullable().optional(),
      deskew: z.boolean().nullable().optional(),
      rotate_pages: z.boolean().nullable().optional(),
      rotate_pages_threshold: z.number().nullable().optional(),
      max_image_pixels: z.number().nullable().optional(),
      color_conversion_strategy: z.string().nullable().optional(),
      user_args: z.record(z.unknown()).nullable().optional().describe("Extra OCRmyPDF arguments"),
      app_title: z.string().nullable().optional(),
      app_logo: z.string().nullable().optional(),
      barcodes_enabled: z.boolean().nullable().optional(),
      barcode_enable_tiff_support: z.boolean().nullable().optional(),
      barcode_string: z.string().nullable().optional(),
      barcode_retain_split_pages: z.boolean().nullable().optional(),
      barcode_enable_asn: z.boolean().nullable().optional(),
      barcode_asn_prefix: z.string().nullable().optional(),
      barcode_upscale: z.number().nullable().optional(),
      barcode_dpi: z.number().nullable().optional(),
      barcode_max_pages: z.number().nullable().optional(),
      barcode_enable_tag: z.boolean().nullable().optional(),
      barcode_tag_mapping: z.record(z.unknown()).nullable().optional(),
    },
    async ({ id, ...body }) => {
      try {
        return ok(
          await client.fetch(`/api/config/${id}/`, {
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
    "get_ui_settings",
    "Get the current user's UI settings, permissions and display preferences",
    {},
    async () => {
      try {
        return ok(await client.fetch("/api/ui_settings/"));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_profile",
    "Get the current user's profile (email, first/last name, social accounts)",
    {},
    async () => {
      try {
        return ok(await client.fetch("/api/profile/"));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_remote_version",
    "Check whether a newer Paperless-ngx release is available upstream",
    {},
    async () => {
      try {
        return ok(await client.fetch("/api/remote_version/"));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool("list_logs", "List the available server log files", {}, async () => {
    try {
      return ok(await client.fetch("/api/logs/"));
    } catch (e) {
      return err(e);
    }
  });

  server.tool(
    "get_log",
    "Read one server log file's contents",
    { id: z.string().describe("Log name, e.g. paperless or mail") },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/logs/${id}/`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_trash",
    "List documents currently in the trash, with the date each is permanently removed",
    { page: z.number().optional(), page_size: z.number().optional() },
    async (params) => {
      try {
        return ok(await client.fetch(`/api/trash/${buildQS(params)}`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "restore_from_trash",
    "Restore trashed documents back into the archive",
    { documents: z.array(z.number()).describe("Document IDs to restore") },
    async ({ documents }) => {
      try {
        return ok(
          await client.fetch("/api/trash/", {
            method: "POST",
            body: JSON.stringify({ action: "restore", documents }),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "empty_trash",
    "Permanently delete trashed documents. This cannot be undone. Omit `documents` to empty the entire trash.",
    {
      documents: z
        .array(z.number())
        .optional()
        .describe("Document IDs to purge; omit to purge everything in the trash"),
    },
    async ({ documents }) => {
      try {
        const body: Record<string, unknown> = { action: "empty" };
        if (documents) body.documents = documents;
        return ok(
          await client.fetch("/api/trash/", { method: "POST", body: JSON.stringify(body) }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "acknowledge_tasks",
    "Dismiss background tasks from the tasks list",
    { tasks: z.array(z.number()).describe("Task IDs to acknowledge") },
    async ({ tasks }) => {
      try {
        return ok(
          await client.fetch("/api/tasks/acknowledge/", {
            method: "POST",
            body: JSON.stringify({ tasks }),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "run_task",
    "Manually dispatch a background task. Superuser only, and requires Paperless-ngx 3.0+.",
    {
      task_type: z
        .enum(["train_classifier", "sanity_check", "llm_index"])
        .describe("Which task to run"),
    },
    async (body) => {
      try {
        return ok(
          await client.fetch("/api/tasks/run/", { method: "POST", body: JSON.stringify(body) }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_task_summary",
    "Aggregated task statistics per task type. Requires Paperless-ngx 3.0+.",
    { days: z.number().optional().describe("Look-back window in days (1-365, default 30)") },
    async (params) => {
      try {
        return ok(await client.fetch(`/api/tasks/summary/${buildQS(params)}`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_task_status_counts",
    "Counts of tasks grouped by status. Requires Paperless-ngx 3.0+.",
    {},
    async () => {
      try {
        return ok(await client.fetch("/api/tasks/status_counts/"));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_active_tasks",
    "Currently pending and running tasks (capped at 50). Requires Paperless-ngx 3.0+.",
    {},
    async () => {
      try {
        return ok(await client.fetch("/api/tasks/active/"));
      } catch (e) {
        return err(e);
      }
    },
  );
}
