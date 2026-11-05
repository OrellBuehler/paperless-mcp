import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.stubEnv("PAPERLESS_URL", "http://localhost:8000");
vi.stubEnv("PAPERLESS_TOKEN", "test-token-123");

const { registerCoreTools } = await import("../tools/core.js");
const { PaperlessClient } = await import("../paperless/client.js");

type ToolHandler = (args: any) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function collectTools(apiVersion: string) {
  const tools = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    },
  };
  registerCoreTools(
    server as any,
    new PaperlessClient("http://localhost:8000", "test-token-123", apiVersion),
  );
  return tools;
}

function res(body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
  };
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function call(i: number) {
  const [url, opts] = mockFetch.mock.calls[i];
  return { url: url as string, method: opts.method, body: opts.body && JSON.parse(opts.body) };
}

describe("resolveApiVersion", () => {
  it("uses the pinned version without a request", async () => {
    const c = new PaperlessClient("http://localhost:8000", "t", "10");
    expect(await c.resolveApiVersion()).toBe(10);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("probes once and caches the X-Api-Version header when unpinned", async () => {
    mockFetch.mockResolvedValue(res({}, { "X-Api-Version": "10" }));
    const c = new PaperlessClient("http://localhost:8000", "t", "");
    expect(await c.resolveApiVersion()).toBe(10);
    expect(await c.resolveApiVersion()).toBe(10);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(call(0).url).toBe("http://localhost:8000/api/profile/");
  });

  it("reuses a version seen on an earlier response", async () => {
    mockFetch.mockResolvedValue(res({}, { "X-Api-Version": "9" }));
    const c = new PaperlessClient("http://localhost:8000", "t", "");
    await c.fetch("/api/tags/");
    expect(await c.resolveApiVersion()).toBe(9);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to 9 without caching when the server sends no header", async () => {
    mockFetch
      .mockResolvedValueOnce(res({}))
      .mockResolvedValueOnce(res({}, { "X-Api-Version": "10" }));
    const c = new PaperlessClient("http://localhost:8000", "t", "");
    expect(await c.resolveApiVersion()).toBe(9);
    expect(await c.resolveApiVersion()).toBe(10);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("list_tasks", () => {
  it("translates filters to v9 names and drops pagination on v9", async () => {
    mockFetch.mockResolvedValue(res([{ id: 1, task_name: "check_sanity" }]));
    const out = await collectTools("9").get("list_tasks")!({
      task_type: "sanity_check",
      trigger_source: "web_ui",
      status: "SUCCESS",
      acknowledged: false,
      page: 2,
    });
    const url = new URL(call(0).url);
    expect(url.pathname).toBe("/api/tasks/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      acknowledged: "false",
      status: "SUCCESS",
      task_name: "check_sanity",
      type: "manual_task",
    });
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: 1, task_name: "check_sanity" }]);
  });

  it("sends v10 filters and pagination on v10", async () => {
    const page = { count: 1, next: null, previous: null, results: [{ task_type: "consume_file" }] };
    mockFetch.mockResolvedValue(res(page));
    const out = await collectTools("10").get("list_tasks")!({
      task_type: "consume_file",
      trigger_source: "api_upload",
      status: "FAILURE",
      page: 2,
      page_size: 10,
    });
    const url = new URL(call(0).url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: "failure",
      task_type: "consume_file",
      trigger_source: "api_upload",
      page: "2",
      page_size: "10",
    });
    expect(JSON.parse(out.content[0].text)).toEqual(page);
  });

  it("detects v10 when no version is pinned", async () => {
    mockFetch
      .mockResolvedValueOnce(res({}, { "X-Api-Version": "10" }))
      .mockResolvedValueOnce(res({ count: 0, results: [] }, { "X-Api-Version": "10" }));
    await collectTools("").get("list_tasks")!({ page: 1 });
    expect(call(0).url).toBe("http://localhost:8000/api/profile/");
    expect(call(1).url).toBe("http://localhost:8000/api/tasks/?page=1");
  });
});

describe("saved view writes", () => {
  for (const version of ["9", "10", ""]) {
    it(`create_saved_view sends v9 with the visibility flags (configured: "${version}")`, async () => {
      mockFetch.mockResolvedValue(res({ id: 12, show_on_dashboard: true, show_in_sidebar: false }));
      const out = await collectTools(version).get("create_saved_view")!({
        name: "Inbox",
        filter_rules: [],
        show_on_dashboard: true,
        show_in_sidebar: false,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:8000/api/saved_views/");
      expect(opts.method).toBe("POST");
      expect(opts.headers.Accept).toBe("application/json; version=9");
      expect(JSON.parse(opts.body)).toEqual({
        name: "Inbox",
        filter_rules: [],
        show_on_dashboard: true,
        show_in_sidebar: false,
      });
      expect(JSON.parse(out.content[0].text)).toMatchObject({ show_on_dashboard: true });
    });
  }

  it("update_saved_view sends v9 with the visibility flags under v10", async () => {
    mockFetch.mockResolvedValue(res({ id: 11 }));
    await collectTools("10").get("update_saved_view")!({ id: 11, show_in_sidebar: false });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/saved_views/11/");
    expect(opts.method).toBe("PATCH");
    expect(opts.headers.Accept).toBe("application/json; version=9");
    expect(JSON.parse(opts.body)).toEqual({ show_in_sidebar: false });
  });
});
