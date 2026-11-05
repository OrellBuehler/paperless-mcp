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

  it("falls back to 9 when the server sends no header", async () => {
    mockFetch.mockResolvedValue(res({}));
    const c = new PaperlessClient("http://localhost:8000", "t", "");
    expect(await c.resolveApiVersion()).toBe(9);
    expect(await c.resolveApiVersion()).toBe(9);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("list_tasks", () => {
  it("translates filters to v9 names and drops pagination on v9", async () => {
    mockFetch.mockResolvedValue(res([{ id: 1, task_name: "check_sanity" }]));
    const out = await collectTools("9").get("list_tasks")!({
      task_type: "sanity_check",
      trigger_source: "web_ui",
      acknowledged: false,
      page: 2,
    });
    const url = new URL(call(0).url);
    expect(url.pathname).toBe("/api/tasks/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      acknowledged: "false",
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
      status: "failure",
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

describe("saved view visibility", () => {
  const uiSettings = {
    user: { id: 1 },
    settings: {
      language: "de-de",
      saved_views: {
        dashboard_views_visible_ids: [3],
        sidebar_views_visible_ids: [3, 11],
        dashboard_views_sort_order: [3],
      },
    },
    permissions: [],
  };

  it("keeps the legacy fields on the saved view under v9", async () => {
    mockFetch.mockResolvedValue(res({ id: 11 }));
    await collectTools("9").get("create_saved_view")!({
      name: "Inbox",
      filter_rules: [],
      show_on_dashboard: true,
      show_in_sidebar: false,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(call(0).body).toEqual({
      name: "Inbox",
      filter_rules: [],
      show_on_dashboard: true,
      show_in_sidebar: false,
    });
  });

  it("create_saved_view writes visibility to UI settings under v10", async () => {
    mockFetch
      .mockResolvedValueOnce(res({ id: 12, name: "Inbox" }))
      .mockResolvedValueOnce(res(uiSettings))
      .mockResolvedValueOnce(res({ success: true }));
    const out = await collectTools("10").get("create_saved_view")!({
      name: "Inbox",
      filter_rules: [],
      show_on_dashboard: true,
      show_in_sidebar: false,
    });
    expect(call(0)).toMatchObject({
      url: "http://localhost:8000/api/saved_views/",
      method: "POST",
      body: { name: "Inbox", filter_rules: [] },
    });
    expect(call(1).url).toBe("http://localhost:8000/api/ui_settings/");
    expect(call(2)).toEqual({
      url: "http://localhost:8000/api/ui_settings/",
      method: "POST",
      body: {
        settings: {
          language: "de-de",
          saved_views: {
            dashboard_views_visible_ids: [3, 12],
            sidebar_views_visible_ids: [3, 11],
            dashboard_views_sort_order: [3],
          },
        },
      },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({
      id: 12,
      name: "Inbox",
      show_on_dashboard: true,
      show_in_sidebar: false,
    });
  });

  it("update_saved_view only touches the flags it was given under v10", async () => {
    mockFetch
      .mockResolvedValueOnce(res({ id: 11 }))
      .mockResolvedValueOnce(res(uiSettings))
      .mockResolvedValueOnce(res({ success: true }));
    const out = await collectTools("10").get("update_saved_view")!({
      id: 11,
      show_in_sidebar: false,
    });
    expect(call(0)).toMatchObject({ method: "PATCH", body: {} });
    expect(call(2).body.settings.saved_views).toEqual({
      dashboard_views_visible_ids: [3],
      sidebar_views_visible_ids: [3],
      dashboard_views_sort_order: [3],
    });
    expect(JSON.parse(out.content[0].text)).toEqual({
      id: 11,
      show_on_dashboard: false,
      show_in_sidebar: false,
    });
  });

  it("update_saved_view skips UI settings when no visibility flag is given", async () => {
    mockFetch.mockResolvedValue(res({ id: 11, name: "Renamed" }));
    await collectTools("10").get("update_saved_view")!({ id: 11, name: "Renamed" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(call(0).body).toEqual({ name: "Renamed" });
  });

  it("starts the visibility lists when UI settings have none", async () => {
    mockFetch
      .mockResolvedValueOnce(res({ id: 5 }, { "X-Api-Version": "10" }))
      .mockResolvedValueOnce(res({ id: 5 }))
      .mockResolvedValueOnce(res({ settings: {} }))
      .mockResolvedValueOnce(res({ success: true }));
    await collectTools("").get("update_saved_view")!({ id: 5, show_on_dashboard: true });
    expect(call(3).body).toEqual({
      settings: {
        saved_views: { dashboard_views_visible_ids: [5], sidebar_views_visible_ids: [] },
      },
    });
  });
});
