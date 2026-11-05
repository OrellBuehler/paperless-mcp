import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaperlessClient } from "./paperless/client.js";
import { config, adminClient, type Toolset } from "./config.js";
import { toolAnnotations } from "./tools/annotations.js";
import { registerCoreTools } from "./tools/core.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerHelperTools } from "./tools/helpers.js";
import { registerUserTools } from "./tools/users.js";
import { registerAutomationTools } from "./tools/automation.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerMailTools } from "./tools/mail.js";
import { registerSharingTools } from "./tools/sharing.js";
import { registerSystemTools } from "./tools/system.js";

export const version: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

type Register = (server: McpServer, client: PaperlessClient) => void;

const toolsets: Record<Exclude<Toolset, "search">, Register> = {
  core: registerCoreTools,
  workflow: registerWorkflowTools,
  helpers: registerHelperTools,
  users: registerUserTools,
  automation: registerAutomationTools,
  documents: registerDocumentTools,
  mail: registerMailTools,
  sharing: registerSharingTools,
  system: registerSystemTools,
};

function toolFilter(server: McpServer): McpServer {
  const register = server.tool.bind(server) as (...args: unknown[]) => unknown;
  const tool = (name: string, ...rest: unknown[]) => {
    const annotations = Object.hasOwn(toolAnnotations, name) ? toolAnnotations[name] : undefined;
    if (config.disabledTools.includes(name)) return;
    if (config.readOnly && !annotations?.readOnlyHint) return;
    const cb = rest.pop();
    return register(name, ...rest, ...(annotations ? [annotations] : []), cb);
  };
  return new Proxy(server, {
    get: (target, prop, receiver) => (prop === "tool" ? tool : Reflect.get(target, prop, receiver)),
  });
}

async function registerTools(server: McpServer, client: PaperlessClient) {
  const filtered = toolFilter(server);
  for (const [name, register] of Object.entries(toolsets)) {
    if (config.toolsets.includes(name as Toolset)) register(filtered, client);
  }
  if (config.embeddingsEnabled && config.toolsets.includes("search")) {
    const { registerSearchTools } = await import("./tools/search.js");
    registerSearchTools(filtered, client);
  }
}

export async function createServer(client: PaperlessClient): Promise<McpServer> {
  const server = new McpServer({ name: "paperless-mcp", version });
  await registerTools(server, client);
  return server;
}

export async function checkToolSelection(): Promise<void> {
  const unknown = config.disabledTools.filter((n) => !Object.hasOwn(toolAnnotations, n));
  if (unknown.length > 0) {
    console.error(`Ignoring unknown tools in PAPERLESS_DISABLED_TOOLS: ${unknown.join(", ")}`);
  }
  const names: string[] = [];
  const recorder = { tool: (name: string) => names.push(name) } as unknown as McpServer;
  await registerTools(recorder, adminClient);
  if (names.length === 0) {
    console.error(
      "No tools left to register: check PAPERLESS_TOOLSETS, PAPERLESS_READ_ONLY, PAPERLESS_DISABLED_TOOLS and EMBEDDINGS_ENABLED",
    );
    process.exit(1);
  }
}
