import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaperlessClient } from "./paperless/client.js";
import { config } from "./config.js";
import { registerCoreTools } from "./tools/core.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerHelperTools } from "./tools/helpers.js";
import { registerUserTools } from "./tools/users.js";
import { registerAutomationTools } from "./tools/automation.js";

export async function createServer(client: PaperlessClient): Promise<McpServer> {
  const server = new McpServer({ name: "paperless-mcp", version: "1.0.0" });
  registerCoreTools(server, client);
  registerWorkflowTools(server, client);
  registerHelperTools(server, client);
  registerUserTools(server, client);
  registerAutomationTools(server, client);
  if (config.embeddingsEnabled) {
    const { registerSearchTools } = await import("./tools/search.js");
    registerSearchTools(server, client);
  }
  return server;
}
