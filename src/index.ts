import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config, adminClient } from "./config.js";
import { createServer } from "./server.js";
import { startHttpServer } from "./http.js";

if (config.transport === "http") {
  startHttpServer();
} else {
  const server = createServer(adminClient);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
