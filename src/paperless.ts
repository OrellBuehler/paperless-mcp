import { config, adminClient } from "./config.js";

export { buildQS, ok, err, summarizeDocs } from "./paperless/format.js";
export type { PaginatedResponse } from "./paperless/format.js";
export { PaperlessClient } from "./paperless/client.js";

export const PAPERLESS_URL = config.baseUrl;
export const PAPERLESS_TOKEN = config.adminToken;

export function paperlessFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  return adminClient.fetch(path, options);
}

export function fetchAllPages<T = unknown>(path: string): Promise<T[]> {
  return adminClient.fetchAllPages<T>(path);
}

export function getDocumentContent(id: number): Promise<string> {
  return adminClient.getDocumentContent(id);
}
