import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.stubEnv("PAPERLESS_URL", "http://localhost:8000");
vi.stubEnv("PAPERLESS_TOKEN", "test-token-123");

const { registerCoreTools } = await import("../tools/core.js");
const { registerHelperTools } = await import("../tools/helpers.js");
const { registerWorkflowTools } = await import("../tools/workflow.js");
const { PaperlessClient } = await import("../paperless/client.js");

type ToolHandler = (args: any) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function collectTools() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    },
  };
  const client = new PaperlessClient("http://localhost:8000", "test-token-123");
  registerCoreTools(server as any, client);
  registerHelperTools(server as any, client);
  registerWorkflowTools(server as any, client);
  return tools;
}

const tools = collectTools();

function mockJson(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

describe("core CRUD tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers the new read + safe-write CRUD tools", () => {
    for (const name of [
      "update_correspondent",
      "update_document_type",
      "update_tag",
      "get_storage_path",
      "create_storage_path",
      "update_storage_path",
      "get_custom_field",
      "create_custom_field",
      "update_custom_field",
    ]) {
      expect(tools.has(name)).toBe(true);
    }
  });

  it("update_document omits OCR content from the response", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 5, title: "New", content: "long ocr text" }));
    const res = await tools.get("update_document")!({ id: 5, title: "New" });
    expect(JSON.parse(res.content[0].text)).toEqual({ id: 5, title: "New" });
  });

  it("bulk_tag_by_content tags matches across all pages", async () => {
    mockFetch
      .mockResolvedValueOnce(mockJson({ count: 2, next: "p2", results: [{ id: 1, title: "a" }] }))
      .mockResolvedValueOnce(mockJson({ count: 2, next: null, results: [{ id: 2, title: "b" }] }))
      .mockResolvedValueOnce(mockJson({ result: "OK" }));
    const res = await tools.get("bulk_tag_by_content")!({ query: "invoice", tag_id: 9 });
    expect(mockFetch.mock.calls[0][0]).toContain("page=1");
    expect(mockFetch.mock.calls[1][0]).toContain("page=2");
    expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({
      documents: [1, 2],
      method: "add_tag",
      parameters: { tag: 9 },
    });
    expect(JSON.parse(res.content[0].text).tagged_count).toBe(2);
  });

  it("update_correspondent PATCHes the id endpoint without the id in the body", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 2 }));
    await tools.get("update_correspondent")!({ id: 2, name: "ACME" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/correspondents/2/",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "ACME" }) }),
    );
  });

  it("update_document_type PATCHes the id endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 3 }));
    await tools.get("update_document_type")!({ id: 3, name: "Invoice" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/document_types/3/",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Invoice" }) }),
    );
  });

  it("update_tag PATCHes the id endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 5, name: "Renamed" }));
    const res = await tools.get("update_tag")!({ id: 5, name: "Renamed", color: "#ff0000" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/tags/5/",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed", color: "#ff0000" }),
      }),
    );
    expect(res.isError).toBeFalsy();
  });

  it("get_storage_path GETs the id endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 7 }));
    await tools.get("get_storage_path")!({ id: 7 });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/storage_paths/7/",
      expect.any(Object),
    );
  });

  it("create_storage_path POSTs the body", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 9 }));
    await tools.get("create_storage_path")!({
      name: "Invoices",
      path: "{correspondent}/{created_year}",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/storage_paths/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Invoices", path: "{correspondent}/{created_year}" }),
      }),
    );
  });

  it("update_storage_path PATCHes the id endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 9 }));
    await tools.get("update_storage_path")!({ id: 9, name: "Renamed" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/storage_paths/9/",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Renamed" }) }),
    );
  });

  it("delete_storage_path DELETEs the id endpoint", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
    const res = await tools.get("delete_storage_path")!({ id: 27 });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/storage_paths/27/",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(res.isError).toBeFalsy();
  });

  it("get_custom_field GETs the id endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 4 }));
    await tools.get("get_custom_field")!({ id: 4 });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/custom_fields/4/",
      expect.any(Object),
    );
  });

  it("create_custom_field POSTs name and data_type", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 1 }));
    await tools.get("create_custom_field")!({ name: "Amount", data_type: "monetary" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/custom_fields/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Amount", data_type: "monetary" }),
      }),
    );
  });

  it("update_custom_field PATCHes the id endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 4 }));
    await tools.get("update_custom_field")!({ id: 4, name: "Total" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/custom_fields/4/",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Total" }) }),
    );
  });

  it("registers the saved-view write tools", () => {
    expect(tools.has("create_saved_view")).toBe(true);
    expect(tools.has("update_saved_view")).toBe(true);
  });

  it("create_saved_view POSTs the body", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 11 }));
    await tools.get("create_saved_view")!({
      name: "Inbox",
      filter_rules: [{ rule_type: 6, value: "3" }],
      show_on_dashboard: true,
      show_in_sidebar: true,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/saved_views/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Inbox",
          filter_rules: [{ rule_type: 6, value: "3" }],
          show_on_dashboard: true,
          show_in_sidebar: true,
        }),
      }),
    );
  });

  it("update_saved_view PATCHes the id endpoint without the id in the body", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 11 }));
    await tools.get("update_saved_view")!({ id: 11, name: "Renamed" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/saved_views/11/",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Renamed" }) }),
    );
  });

  it("returns an MCP error result when the API call fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: () => Promise.resolve("validation failed"),
    });
    const res = await tools.get("update_tag")!({ id: 1, name: "x" });
    expect(res.isError).toBe(true);
  });
});

describe("document read tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("list_documents strips OCR content from results", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson({
        count: 1,
        next: null,
        results: [{ id: 1, title: "Invoice", content: "SECRET OCR TEXT" }],
      }),
    );
    const res = await tools.get("list_documents")!({});
    expect(res.content[0].text).not.toContain("SECRET OCR TEXT");
    const payload = JSON.parse(res.content[0].text);
    expect(payload.results[0]).toEqual({ id: 1, title: "Invoice" });
  });

  it("search_documents strips OCR content from results", async () => {
    mockFetch.mockResolvedValueOnce(
      mockJson({ count: 1, results: [{ id: 2, title: "X", content: "HIDDEN" }] }),
    );
    const res = await tools.get("search_documents")!({ query: "x" });
    expect(res.content[0].text).not.toContain("HIDDEN");
  });

  it("get_documents returns full content for the requested ids", async () => {
    mockFetch
      .mockResolvedValueOnce(mockJson({ id: 1, title: "A", content: "full text one" }))
      .mockResolvedValueOnce(mockJson({ id: 2, title: "B", content: "full text two" }));
    const res = await tools.get("get_documents")!({ ids: [1, 2] });
    const payload = JSON.parse(res.content[0].text);
    expect(payload).toHaveLength(2);
    expect(payload[0].content).toBe("full text one");
    expect(payload[1].content).toBe("full text two");
  });

  it("get_documents truncates content when max_content_length is set", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 1, title: "A", content: "abcdefghij" }));
    const res = await tools.get("get_documents")!({ ids: [1], max_content_length: 4 });
    const payload = JSON.parse(res.content[0].text);
    expect(payload[0].content).toBe("abcd");
    expect(payload[0].content_truncated).toBe(true);
    expect(payload[0].content_length).toBe(10);
  });
});

describe("permission writes", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("update_tag forwards owner and set_permissions in the PATCH body", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 5 }));
    await tools.get("update_tag")!({
      id: 5,
      owner: 2,
      set_permissions: { view: { groups: [1] }, change: { groups: [1] } },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/tags/5/",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          owner: 2,
          set_permissions: { view: { groups: [1] }, change: { groups: [1] } },
        }),
      }),
    );
  });

  it("update_storage_path forwards set_permissions", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 9 }));
    await tools.get("update_storage_path")!({
      id: 9,
      set_permissions: { view: { groups: [1] }, change: { groups: [1] } },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/storage_paths/9/",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          set_permissions: { view: { groups: [1] }, change: { groups: [1] } },
        }),
      }),
    );
  });

  it("registers bulk_set_object_permissions", () => {
    expect(tools.has("bulk_set_object_permissions")).toBe(true);
  });

  it("bulk_set_object_permissions POSTs a set_permissions operation", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ result: "OK" }));
    await tools.get("bulk_set_object_permissions")!({
      object_type: "tags",
      objects: [9, 6],
      permissions: { view: { groups: [1] }, change: { groups: [1] } },
      merge: true,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/bulk_edit_objects/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          objects: [9, 6],
          object_type: "tags",
          operation: "set_permissions",
          permissions: { view: { groups: [1] }, change: { groups: [1] } },
          merge: true,
        }),
      }),
    );
  });

  it("bulk_set_object_permissions can set owner only", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ result: "OK" }));
    await tools.get("bulk_set_object_permissions")!({
      object_type: "correspondents",
      objects: [3],
      owner: 2,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/bulk_edit_objects/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          objects: [3],
          object_type: "correspondents",
          operation: "set_permissions",
          owner: 2,
        }),
      }),
    );
  });
});

describe("tax-report filters and helpers", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("list_documents forwards custom_field_query, inclusive date and __in filters", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ count: 0, next: null, results: [] }));
    await tools.get("list_documents")!({
      custom_field_query: '["Betrag", "gt", 100]',
      created__date__gte: "2025-01-01",
      created__date__lte: "2025-12-31",
      correspondent__id__in: [1, 2],
      document_type__id__in: [10, 11],
    });
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("custom_field_query")).toBe('["Betrag", "gt", 100]');
    expect(url.searchParams.get("created__date__gte")).toBe("2025-01-01");
    expect(url.searchParams.get("created__date__lte")).toBe("2025-12-31");
    expect(url.searchParams.get("correspondent__id__in")).toBe("1,2");
    expect(url.searchParams.get("document_type__id__in")).toBe("10,11");
  });

  it("yearly_document_check reports combos missing versus the previous year", async () => {
    mockFetch.mockImplementation((input: string) => {
      const url = new URL(input);
      if (url.pathname === "/api/correspondents/") {
        return Promise.resolve(
          mockJson({
            count: 2,
            next: null,
            results: [
              { id: 1, name: "Employer" },
              { id: 2, name: "Bank" },
            ],
          }),
        );
      }
      if (url.pathname === "/api/document_types/") {
        return Promise.resolve(
          mockJson({
            count: 2,
            next: null,
            results: [
              { id: 10, name: "Lohnausweis" },
              { id: 11, name: "Steuerauszug" },
            ],
          }),
        );
      }
      if (url.searchParams.get("created__date__gte") === "2025-01-01") {
        return Promise.resolve(
          mockJson({
            count: 1,
            next: null,
            results: [{ id: 100, title: "Lohnausweis 2025", correspondent: 1, document_type: 10 }],
          }),
        );
      }
      return Promise.resolve(
        mockJson({
          count: 2,
          next: null,
          results: [
            { id: 90, title: "Lohnausweis 2024", correspondent: 1, document_type: 10 },
            { id: 91, title: "Steuerauszug 2024", correspondent: 2, document_type: 11 },
          ],
        }),
      );
    });

    const res = await tools.get("yearly_document_check")!({ year: 2025 });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.total_documents).toEqual({ "2025": 1, "2024": 2 });
    expect(payload.missing_this_year).toEqual([
      {
        correspondent: 2,
        correspondent_name: "Bank",
        document_type: 11,
        document_type_name: "Steuerauszug",
        count: 1,
        example_titles_from_previous_year: ["Steuerauszug 2024"],
      },
    ]);
    expect(payload.new_this_year).toEqual([]);
    expect(payload.combos_in_both).toBe(1);

    const docCalls = mockFetch.mock.calls
      .map((c) => new URL(c[0] as string))
      .filter((u) => u.pathname === "/api/documents/");
    expect(docCalls.some((u) => u.searchParams.get("created__date__lt") === "2026-01-01")).toBe(
      true,
    );
    expect(docCalls.some((u) => u.searchParams.get("created__date__gte") === "2024-01-01")).toBe(
      true,
    );
  });

  it("yearly_document_check scopes both years to the given tags", async () => {
    mockFetch.mockImplementation((input: string) => {
      const url = new URL(input);
      if (url.pathname === "/api/documents/") {
        expect(url.searchParams.get("tags__id__all")).toBe("5,6");
      }
      return Promise.resolve(mockJson({ count: 0, next: null, results: [] }));
    });
    const res = await tools.get("yearly_document_check")!({ year: 2025, tags__id__all: [5, 6] });
    expect(res.isError).toBeFalsy();
  });
});

describe("Paperless-ngx 3.1 to 3.5 additions", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function requestUrl(i: number) {
    return new URL(mockFetch.mock.calls[i][0] as string);
  }

  function requestBody(i: number) {
    return JSON.parse(mockFetch.mock.calls[i][1].body);
  }

  it("bulk_edit_documents POSTs the method and parameters and passes the task_id through", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ result: "OK", task_id: "t-1" }));
    const res = await tools.get("bulk_edit_documents")!({
      documents: [1, 2],
      method: "modify_custom_fields",
      parameters: { add_custom_fields: { "3": "x" }, remove_custom_fields: [4] },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/documents/bulk_edit/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          documents: [1, 2],
          method: "modify_custom_fields",
          parameters: { add_custom_fields: { "3": "x" }, remove_custom_fields: [4] },
        }),
      }),
    );
    expect(JSON.parse(res.content[0].text)).toEqual({ result: "OK", task_id: "t-1" });
  });

  it("bulk_edit_documents sends empty parameters when none are given", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ result: "OK", task_id: "t-2" }));
    await tools.get("bulk_edit_documents")!({ documents: [5], method: "delete" });
    expect(requestBody(0)).toEqual({ documents: [5], method: "delete", parameters: {} });
  });

  it("bulk_tag_by_content returns the queued task from the bulk edit", async () => {
    mockFetch
      .mockResolvedValueOnce(
        mockJson({ count: 1, next: null, results: [{ id: 7, title: "Invoice" }] }),
      )
      .mockResolvedValueOnce(mockJson({ result: "OK", task_id: "t-3" }));
    const res = await tools.get("bulk_tag_by_content")!({ query: "invoice", tag_id: 9 });
    expect(JSON.parse(res.content[0].text).result).toEqual({ result: "OK", task_id: "t-3" });
  });

  it("list_documents forwards has_duplicates", async () => {
    mockFetch.mockResolvedValue(mockJson({ count: 0, next: null, results: [] }));
    await tools.get("list_documents")!({ has_duplicates: true });
    expect(requestUrl(0).searchParams.get("has_duplicates")).toBe("true");
    await tools.get("list_documents")!({ has_duplicates: false });
    expect(requestUrl(1).searchParams.get("has_duplicates")).toBe("false");
  });

  it("list_documents omits has_duplicates when not given", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ count: 0, next: null, results: [] }));
    await tools.get("list_documents")!({ is_in_inbox: true });
    expect(requestUrl(0).searchParams.has("has_duplicates")).toBe(false);
  });

  it("list_documents forwards barcode queries", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ count: 0, next: null, results: [] }));
    await tools.get("list_documents")!({ query: "barcodes:DE89370400440532013000" });
    expect(requestUrl(0).pathname).toBe("/api/documents/");
    expect(requestUrl(0).searchParams.get("query")).toBe("barcodes:DE89370400440532013000");
  });

  it("list_documents forwards relative-date custom field queries", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ count: 0, next: null, results: [] }));
    const query = '["Ablauf", "range", ["today", "in 30 days"]]';
    await tools.get("list_documents")!({ custom_field_query: query });
    expect(requestUrl(0).searchParams.get("custom_field_query")).toBe(query);
  });

  it("get_document_metadata keeps the barcodes field", async () => {
    const meta = {
      original_filename: "scan.pdf",
      barcodes: [{ page: 1, value: "DE89370400440532013000", format: "QRCode" }],
    };
    mockFetch.mockResolvedValueOnce(mockJson(meta));
    const res = await tools.get("get_document_metadata")!({ id: 3 });
    expect(mockFetch.mock.calls[0][0]).toBe("http://localhost:8000/api/documents/3/metadata/");
    expect(JSON.parse(res.content[0].text)).toEqual(meta);
  });

  it("list_documents strips only content and keeps duplicate and barcode fields", async () => {
    const doc = {
      id: 1,
      content: "OCR",
      duplicate_documents: [{ id: 2, title: "Copy", deleted_at: null }],
      barcodes: [{ page: 1, value: "x", format: "QRCode" }],
    };
    mockFetch.mockResolvedValue(mockJson({ count: 1, next: null, results: [doc] }));
    const res = await tools.get("list_documents")!({ query: "x" });
    expect(JSON.parse(res.content[0].text).results[0]).toEqual({
      id: 1,
      duplicate_documents: doc.duplicate_documents,
      barcodes: doc.barcodes,
    });
  });

  it("add_document_note sends only the note by default", async () => {
    mockFetch.mockResolvedValueOnce(mockJson([]));
    await tools.get("add_document_note")!({ id: 4, note: "plain" });
    expect(mockFetch.mock.calls[0][0]).toBe("http://localhost:8000/api/documents/4/notes/");
    expect(requestBody(0)).toEqual({ note: "plain" });
  });

  it("add_document_note sends the note format when given", async () => {
    mockFetch.mockResolvedValueOnce(mockJson([]));
    await tools.get("add_document_note")!({ id: 4, note: "**bold**", format: "markdown" });
    expect(requestBody(0)).toEqual({ note: "**bold**", format: "markdown" });
  });

  it("create_saved_view and update_saved_view send the icon", async () => {
    mockFetch.mockResolvedValue(mockJson({ id: 12 }));
    await tools.get("create_saved_view")!({
      name: "Invoices",
      filter_rules: [{ rule_type: 50, value: "true" }],
      icon: "receipt",
      show_on_dashboard: false,
      show_in_sidebar: true,
    });
    expect(requestBody(0)).toEqual({
      name: "Invoices",
      filter_rules: [{ rule_type: 50, value: "true" }],
      icon: "receipt",
      show_on_dashboard: false,
      show_in_sidebar: true,
    });
    await tools.get("update_saved_view")!({ id: 12, icon: "bank" });
    expect(mockFetch.mock.calls[1][0]).toBe("http://localhost:8000/api/saved_views/12/");
    expect(requestBody(1)).toEqual({ icon: "bank" });
  });
});
