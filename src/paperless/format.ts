export function buildQS(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      sp.set(k, v.join(","));
    } else {
      sp.set(k, String(v));
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

export function summarizeDocs(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(omitContent);
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.results)) return { ...obj, results: obj.results.map(omitContent) };
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
