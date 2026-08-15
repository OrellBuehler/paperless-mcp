import type { PaginatedResponse } from "./format.js";

export class PaperlessClient {
  readonly baseUrl: string;
  readonly token: string;
  readonly apiVersion: string;

  constructor(baseUrl: string, token: string, apiVersion = "9") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.apiVersion = apiVersion;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Token ${this.token}`,
      ...(this.apiVersion ? { Accept: `application/json; version=${this.apiVersion}` } : {}),
    };
  }

  async fetch(path: string, options: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        ...this.authHeaders(),
        ...(options.body && typeof options.body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
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
    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        ...this.authHeaders(),
        ...(options.body && typeof options.body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers,
      },
    });
  }

  upload(path: string, form: FormData, method = "POST"): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.authHeaders(),
      body: form,
    });
  }
}
