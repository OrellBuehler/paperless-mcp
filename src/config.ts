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

export const config = {
  baseUrl,
  adminToken,
  transport: (process.env.MCP_TRANSPORT === "http" ? "http" : "stdio") as "http" | "stdio",
  port: parseInt(process.env.PORT || "3001", 10),
  embeddingsEnabled: /^(1|true|yes)$/i.test(process.env.EMBEDDINGS_ENABLED || ""),
  allowedOrigins: csv(process.env.MCP_ALLOWED_ORIGINS),
  allowedHosts: csv(process.env.MCP_ALLOWED_HOSTS),
};

export const adminClient = new PaperlessClient(baseUrl, adminToken);

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
  const client = new PaperlessClient(baseUrl, token);
  if (clientCache.size >= MAX_CACHE) {
    const oldest = clientCache.keys().next().value;
    if (oldest !== undefined) clientCache.delete(oldest);
  }
  clientCache.set(token, client);
  return client;
}
