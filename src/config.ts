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

function nonNegativeInt(value: string | undefined, fallback: number): number {
  const raw = (value ?? "").trim();
  return /^\d+$/.test(raw) ? Number(raw) : fallback;
}

const timeoutMs = nonNegativeInt(process.env.PAPERLESS_TIMEOUT_MS, 60000);

const clientOptions = {
  timeoutMs: timeoutMs > 2147483647 ? 60000 : timeoutMs,
  maxRetries: Math.min(nonNegativeInt(process.env.PAPERLESS_MAX_RETRIES, 2), 10),
};

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
};

export const adminClient = new PaperlessClient(baseUrl, adminToken, apiVersion, clientOptions);

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
  const client = new PaperlessClient(baseUrl, token, apiVersion, clientOptions);
  if (clientCache.size >= MAX_CACHE) {
    const oldest = clientCache.keys().next().value;
    if (oldest !== undefined) clientCache.delete(oldest);
  }
  clientCache.set(token, client);
  return client;
}
