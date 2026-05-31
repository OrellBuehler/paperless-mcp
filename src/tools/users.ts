import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildQS, ok, err } from "../paperless/format.js";
import type { PaperlessClient } from "../paperless/client.js";

export function registerUserTools(server: McpServer, client: PaperlessClient) {
  // --- Users ---

  server.tool(
    "list_users",
    "List all users",
    {
      page: z.number().optional(),
      page_size: z.number().optional(),
      ordering: z.string().optional(),
    },
    async (params) => {
      try {
        return ok(await client.fetch(`/api/users/${buildQS(params)}`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_user",
    "Get a single user by ID. Reveals the permission-string format used by user_permissions.",
    { id: z.number() },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/users/${id}/`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "create_user",
    "Create a new user (requires Paperless admin privileges)",
    {
      username: z.string(),
      password: z.string().optional(),
      email: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      is_active: z.boolean().optional(),
      is_staff: z.boolean().optional(),
      is_superuser: z.boolean().optional(),
      groups: z.array(z.number()).optional().describe("Group IDs"),
      user_permissions: z
        .array(z.string())
        .optional()
        .describe(
          "Permission codenames like 'documents.view_document'. Call get_user/get_group to see valid strings.",
        ),
    },
    async (body) => {
      try {
        return ok(
          await client.fetch("/api/users/", {
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
    "update_user",
    "Update an existing user (partial update; requires Paperless admin privileges)",
    {
      id: z.number(),
      username: z.string().optional(),
      password: z.string().optional(),
      email: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      is_active: z.boolean().optional(),
      is_staff: z.boolean().optional(),
      is_superuser: z.boolean().optional(),
      groups: z.array(z.number()).optional().describe("Group IDs"),
      user_permissions: z.array(z.string()).optional(),
    },
    async ({ id, ...body }) => {
      try {
        return ok(
          await client.fetch(`/api/users/${id}/`, {
            method: "PATCH",
            body: JSON.stringify(body),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  // --- Groups ---

  server.tool(
    "list_groups",
    "List all groups",
    {
      page: z.number().optional(),
      page_size: z.number().optional(),
      ordering: z.string().optional(),
    },
    async (params) => {
      try {
        return ok(await client.fetch(`/api/groups/${buildQS(params)}`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "get_group",
    "Get a single group by ID. Reveals the permission-string format used by permissions.",
    { id: z.number() },
    async ({ id }) => {
      try {
        return ok(await client.fetch(`/api/groups/${id}/`));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.tool(
    "create_group",
    "Create a new group (requires Paperless admin privileges)",
    {
      name: z.string(),
      permissions: z
        .array(z.string())
        .optional()
        .describe("Permission codenames like 'documents.view_document'"),
    },
    async (body) => {
      try {
        return ok(
          await client.fetch("/api/groups/", {
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
    "update_group",
    "Update an existing group (partial update; requires Paperless admin privileges)",
    {
      id: z.number(),
      name: z.string().optional(),
      permissions: z.array(z.string()).optional(),
    },
    async ({ id, ...body }) => {
      try {
        return ok(
          await client.fetch(`/api/groups/${id}/`, {
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
