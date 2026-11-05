import { PaperlessClient } from "./paperless/client.js";

const baseUrl = (process.env.PAPERLESS_URL || "").replace(/\/+$/, "");
const adminToken = process.env.PAPERLESS_TOKEN || "";

if (!baseUrl || !adminToken) {
  console.error("PAPERLESS_URL and PAPERLESS_TOKEN environment variables are required");
  process.exit(1);
}

function csv(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function apiVersionFrom(value: string | undefined): string {
  const raw = (value ?? "9").trim();
  return /^(none|off|auto)$/i.test(raw) ? "" : raw;
}

const apiVersion = apiVersionFrom(process.env.PAPERLESS_API_VERSION);

export const TOOLSETS = [
  "core",
  "workflow",
  "helpers",
  "users",
  "automation",
  "documents",
  "mail",
  "sharing",
  "system",
  "search",
] as const;
export type Toolset = (typeof TOOLSETS)[number];

function toolsetsFrom(value: string | undefined): Toolset[] {
  const names = csv(value).map((s) => s.toLowerCase());
  if (names.length === 0) return [...TOOLSETS];
  const unknown = names.filter((n) => !(TOOLSETS as readonly string[]).includes(n));
  if (unknown.length > 0) {
    console.error(
      `Unknown PAPERLESS_TOOLSETS: ${unknown.join(", ")}. Valid toolsets: ${TOOLSETS.join(", ")}`,
    );
    process.exit(1);
  }
  return names as Toolset[];
}

export const config = {
  baseUrl,
  adminToken,
  apiVersion,
  transport: (process.env.MCP_TRANSPORT === "http" ? "http" : "stdio") as "http" | "stdio",
  port: parseInt(process.env.PORT || "3001", 10),
  embeddingsEnabled: /^(1|true|yes)$/i.test(process.env.EMBEDDINGS_ENABLED || ""),
  allowedOrigins: csv(process.env.MCP_ALLOWED_ORIGINS),
  allowedHosts: csv(process.env.MCP_ALLOWED_HOSTS),
  oauthEnabled: Boolean((process.env.MCP_OAUTH_ISSUER || "").trim()),
  toolsets: toolsetsFrom(process.env.PAPERLESS_TOOLSETS),
  readOnly: /^(1|true|yes)$/i.test(process.env.PAPERLESS_READ_ONLY || ""),
  disabledTools: csv(process.env.PAPERLESS_DISABLED_TOOLS),
};

if (
  process.env.PAPERLESS_TOOLSETS &&
  config.toolsets.includes("search") &&
  !config.embeddingsEnabled
) {
  console.error(
    "PAPERLESS_TOOLSETS includes search, but search tools need EMBEDDINGS_ENABLED=true",
  );
}

export const adminClient = new PaperlessClient(baseUrl, adminToken, apiVersion);

const clientCache = new Map<string, PaperlessClient>();
const MAX_CACHE = 100;

export function clientFor(token: string): PaperlessClient {
  if (token === adminToken) return adminClient;
  const existing = clientCache.get(token);
  if (existing) {
    clientCache.delete(token);
    clientCache.set(token, existing);
    return existing;
  }
  const client = new PaperlessClient(baseUrl, token, apiVersion);
  if (clientCache.size >= MAX_CACHE) {
    const oldest = clientCache.keys().next().value;
    if (oldest !== undefined) clientCache.delete(oldest);
  }
  clientCache.set(token, client);
  return client;
}
