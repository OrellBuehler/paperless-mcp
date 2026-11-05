import type { PaginatedResponse } from "./format.js";

export interface ClientOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10000;

function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

function retryAfterMs(res: Response): number | undefined {
  const value = res.headers?.get?.("retry-after")?.trim();
  if (!value) return undefined;
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  if (Number.isNaN(ms)) return undefined;
  return Math.min(Math.max(ms, 0), MAX_DELAY_MS);
}

function backoffMs(attempt: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt * (0.5 + Math.random()));
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class PaperlessClient {
  readonly baseUrl: string;
  readonly token: string;
  readonly apiVersion: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  onUnauthorized?: () => void;

  constructor(baseUrl: string, token: string, apiVersion = "9", options: ClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.apiVersion = apiVersion;
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Token ${this.token}`,
      ...(this.apiVersion ? { Accept: `application/json; version=${this.apiVersion}` } : {}),
    };
  }

  private withHeaders(options: RequestInit): RequestInit {
    return {
      ...options,
      headers: {
        ...this.authHeaders(),
        ...(options.body && typeof options.body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers,
      },
    };
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    handle: (res: Response) => Promise<T>,
    retry = true,
  ): Promise<T> {
    const method = (init.method || "GET").toUpperCase();
    const retries = retry && (method === "GET" || method === "HEAD") ? this.maxRetries : 0;
    const timeoutError = () =>
      new Error(`Paperless request timed out after ${this.timeoutMs}ms: ${method} ${path}`);
    for (let attempt = 0; ; attempt++) {
      const timeout = new AbortController();
      const timer =
        this.timeoutMs > 0 ? setTimeout(() => timeout.abort(), this.timeoutMs) : undefined;
      const signal = init.signal ? anySignal([init.signal, timeout.signal]) : timeout.signal;
      let delay: number;
      try {
        let res: Response | undefined;
        let failure: unknown;
        try {
          res = await fetch(`${this.baseUrl}${path}`, { ...init, signal });
        } catch (e) {
          failure = e;
        }
        if (!res) {
          if (init.signal?.aborted) throw failure;
          const error = timeout.signal.aborted ? timeoutError() : failure;
          if (attempt >= retries) throw error;
          delay = backoffMs(attempt);
        } else if (attempt < retries && RETRY_STATUSES.has(res.status)) {
          delay = retryAfterMs(res) ?? backoffMs(attempt);
          res.body?.cancel().catch(() => {});
        } else {
          try {
            return await handle(res);
          } catch (e) {
            if (timeout.signal.aborted && !init.signal?.aborted) throw timeoutError();
            throw e;
          }
        }
      } finally {
        clearTimeout(timer);
      }
      await sleep(delay, init.signal);
    }
  }

  fetch(path: string, options: RequestInit = {}): Promise<unknown> {
    return this.request(path, this.withHeaders(options), async (res) => {
      if (!res.ok) {
        if (res.status === 401) this.onUnauthorized?.();
        const body = await res.text();
        throw new Error(`${res.status} ${res.statusText}: ${body}`);
      }
      if (res.status === 204) return { success: true };
      return res.json();
    });
  }

  async fetchAllPages<T = unknown>(path: string): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    while (true) {
      const sep = path.includes("?") ? "&" : "?";
      const data = (await this.fetch(
        `${path}${sep}page=${page}&page_size=100`,
      )) as PaginatedResponse<T>;
      all.push(...data.results);
      if (!data.next) break;
      page++;
    }
    return all;
  }

  async getDocumentContent(id: number): Promise<string> {
    const doc = (await this.fetch(`/api/documents/${id}/`)) as { content?: string };
    return doc.content || "";
  }

  download(path: string, options: RequestInit = {}): Promise<Response> {
    return this.request(path, this.withHeaders(options), async (res) => res);
  }

  upload(path: string, form: FormData, method = "POST"): Promise<Response> {
    return this.request(
      path,
      { method, headers: this.authHeaders(), body: form },
      async (res) => res,
      false,
    );
  }
}
