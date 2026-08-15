import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildQS, ok, err } from "../paperless/format.js";
import type { PaperlessClient } from "../paperless/client.js";

const permissionsSchema = z
  .object({
    view: z.object({ users: z.array(z.number()), groups: z.array(z.number()) }).partial(),
    change: z.object({ users: z.array(z.number()), groups: z.array(z.number()) }).partial(),
  })
  .partial()
  .optional()
  .describe("Sharing permissions: { view: { users, groups }, change: { users, groups } }");

const accountRest = {
  imap_port: z.number().optional(),
  imap_security: z.number().optional().describe("1=no encryption, 2=SSL, 3=STARTTLS"),
  character_set: z.string().optional(),
  is_token: z.boolean().optional().describe("Treat password as an access token"),
  account_type: z.number().optional().describe("1=IMAP, 2=Gmail OAuth, 3=Outlook OAuth"),
  owner: z.number().nullable().optional(),
  set_permissions: permissionsSchema,
};

const accountCreate = {
  name: z.string(),
  imap_server: z.string(),
  username: z.string(),
  password: z.string(),
  ...accountRest,
};

const accountUpdate = {
  name: z.string().optional(),
  imap_server: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  ...accountRest,
};

const ruleRest = {
  enabled: z.boolean().optional(),
  folder: z.string().optional().describe("Mail folder to scan, e.g. INBOX"),
  filter_from: z.string().nullable().optional(),
  filter_to: z.string().nullable().optional(),
  filter_subject: z.string().nullable().optional(),
  filter_body: z.string().nullable().optional(),
  filter_attachment_filename_include: z.string().nullable().optional(),
  filter_attachment_filename_exclude: z.string().nullable().optional(),
  maximum_age: z.number().optional().describe("Only consider mails newer than this many days"),
  action: z
    .number()
    .optional()
    .describe(
      "1=delete, 2=move to folder, 3=mark read, 4=flag, 5=tag (2 and 5 need action_parameter)",
    ),
  action_parameter: z.string().nullable().optional(),
  assign_title_from: z
    .number()
    .optional()
    .describe("1=subject, 2=attachment filename, 3=do not assign"),
  assign_tags: z.array(z.number()).optional(),
  assign_correspondent_from: z
    .number()
    .optional()
    .describe("1=none, 2=mail address, 3=name, 4=use assign_correspondent"),
  assign_correspondent: z.number().nullable().optional(),
  assign_document_type: z.number().nullable().optional(),
  assign_owner_from_rule: z.boolean().optional(),
  order: z.number().optional(),
  attachment_type: z.number().optional().describe("1=attachments only, 2=include inline"),
  consumption_scope: z
    .number()
    .optional()
    .describe("1=attachments only, 2=full mail as .eml, 3=both"),
  pdf_layout: z
    .number()
    .optional()
    .describe("0=system default, 1=text then HTML, 2=HTML then text, 3=HTML only, 4=text only"),
  owner: z.number().nullable().optional(),
  set_permissions: permissionsSchema,
};

const ruleCreate = {
  name: z.string(),
  account: z.number().describe("Mail account ID"),
  ...ruleRest,
};

const ruleUpdate = {
  name: z.string().optional(),
  account: z.number().optional().describe("Mail account ID"),
  ...ruleRest,
};

export function registerMailTools(server: McpServer, client: PaperlessClient) {
  server.tool(
    "list_mail_accounts",
    "List configured email accounts that Paperless polls for documents",
    { page: z.number().optional(), page_size: z.number().optional() },
    async (params) => {
      try {
        return ok(await client.fetch(`/api/mail_accounts/${buildQS(params)}`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_mail_account",
    "Get a single mail account by ID",
    { id: z.number() },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/mail_accounts/${id}/`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool("create_mail_account", "Create a new mail account", accountCreate, async (body) => {
    try {
      return ok(
        await client.fetch("/api/mail_accounts/", { method: "POST", body: JSON.stringify(body) }),
      );
    } catch (e) {
      return err(e);
    }
  });

  server.tool(
    "update_mail_account",
    "Update an existing mail account (partial update)",
    { id: z.number(), ...accountUpdate },
    async ({ id, ...body }) => {
      try {
        return ok(
          await client.fetch(`/api/mail_accounts/${id}/`, {
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
    "test_mail_account",
    "Test mail account credentials without saving them. Pass the full connection details.",
    accountCreate,
    async (body) => {
      try {
        return ok(
          await client.fetch("/api/mail_accounts/test/", {
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
    "process_mail_account",
    "Trigger an immediate mail fetch for one account instead of waiting for the schedule",
    { id: z.number().describe("Mail account ID") },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/mail_accounts/${id}/process/`, { method: "POST" }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "list_mail_rules",
    "List mail rules (which messages get consumed, and how they are tagged)",
    { page: z.number().optional(), page_size: z.number().optional() },
    async (params) => {
      try {
        return ok(await client.fetch(`/api/mail_rules/${buildQS(params)}`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_mail_rule",
    "Get a single mail rule by ID",
    { id: z.number() },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/mail_rules/${id}/`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool("create_mail_rule", "Create a new mail rule", ruleCreate, async (body) => {
    try {
      return ok(
        await client.fetch("/api/mail_rules/", { method: "POST", body: JSON.stringify(body) }),
      );
    } catch (e) {
      return err(e);
    }
  });

  server.tool(
    "update_mail_rule",
    "Update an existing mail rule (partial update)",
    { id: z.number(), ...ruleUpdate },
    async ({ id, ...body }) => {
      try {
        return ok(
          await client.fetch(`/api/mail_rules/${id}/`, {
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
    "list_processed_mail",
    "List mail messages Paperless has already processed (useful for debugging why a mail was skipped)",
    {
      rule: z.number().optional().describe("Filter by mail rule ID"),
      page: z.number().optional(),
      page_size: z.number().optional(),
    },
    async (params) => {
      try {
        return ok(await client.fetch(`/api/processed_mail/${buildQS(params)}`));
      } catch (e) {
        return err(e);
      }
    },
  );
}
