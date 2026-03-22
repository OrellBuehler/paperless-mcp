import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCoreTools } from "./tools/core.js";
import { registerSearchTools } from "./tools/search.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerHelperTools } from "./tools/helpers.js";

const server = new McpServer({ name: "paperless-mcp", version: "1.0.0" });

registerCoreTools(server);
registerSearchTools(server);
registerWorkflowTools(server);
registerHelperTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
