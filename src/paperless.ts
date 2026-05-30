const PAPERLESS_URL = process.env.PAPERLESS_URL?.replace(/\/+$/, "");
const PAPERLESS_TOKEN = process.env.PAPERLESS_TOKEN;

if (!PAPERLESS_URL || !PAPERLESS_TOKEN) {
  console.error("PAPERLESS_URL and PAPERLESS_TOKEN environment variables are required");
  process.exit(1);
}

export { PAPERLESS_URL, PAPERLESS_TOKEN };

export async function paperlessFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const url = `${PAPERLESS_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Token ${PAPERLESS_TOKEN}`,
      ...(options.body && typeof options.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return { success: true };
  return res.json();
}

export function buildQS(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      if (Array.isArray(v)) {
        v.forEach(item => sp.append(k, String(item)));
      } else {
        sp.set(k, String(v));
      }
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export function err(e: unknown) {
  return { content: [{ type: "text" as const, text: String(e) }], isError: true as const };
}

function omitContent(doc: unknown): unknown {
  if (doc && typeof doc === "object" && "content" in doc) {
    const { content, ...rest } = doc as Record<string, unknown>;
    return rest;
  }
  return doc;
}

// Strip the heavy `content` (OCR text) field from list/search responses so the
// model only sees document metadata. Handles paginated responses, bare arrays,
// and single document objects. Use get_document/get_documents for full content.
export function summarizeDocs(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(omitContent);
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.results)) {
      return { ...obj, results: obj.results.map(omitContent) };
    }
    return omitContent(obj);
  }
  return data;
}

export interface PaginatedResponse<T = unknown> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export async function fetchAllPages<T = unknown>(path: string): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  while (true) {
    const data = await paperlessFetch(`${path}${path.includes("?") ? "&" : "?"}page=${page}&page_size=100`) as PaginatedResponse<T>;
    all.push(...data.results);
    if (!data.next) break;
    page++;
  }
  return all;
}

export async function getDocumentContent(id: number): Promise<string> {
  const doc = await paperlessFetch(`/api/documents/${id}/`) as { content?: string };
  return doc.content || "";
}
