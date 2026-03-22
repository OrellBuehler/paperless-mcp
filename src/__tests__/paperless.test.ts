import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.stubEnv("PAPERLESS_URL", "http://localhost:8000");
vi.stubEnv("PAPERLESS_TOKEN", "test-token-123");

const { buildQS, ok, err, paperlessFetch, fetchAllPages, getDocumentContent } = await import("../paperless.js");

describe("buildQS", () => {
  it("returns empty string for empty params", () => {
    expect(buildQS({})).toBe("");
  });

  it("returns empty string when all values are undefined or null", () => {
    expect(buildQS({ a: undefined, b: null })).toBe("");
  });

  it("builds simple key-value pairs", () => {
    const result = buildQS({ page: 1, page_size: 25 });
    expect(result).toBe("?page=1&page_size=25");
  });

  it("handles string values", () => {
    expect(buildQS({ query: "hello world" })).toBe("?query=hello+world");
  });

  it("handles boolean values", () => {
    expect(buildQS({ is_inbox: true })).toBe("?is_inbox=true");
    expect(buildQS({ is_inbox: false })).toBe("?is_inbox=false");
  });

  it("handles array values with repeated keys", () => {
    const result = buildQS({ tags__id__all: [1, 2, 3] });
    expect(result).toBe("?tags__id__all=1&tags__id__all=2&tags__id__all=3");
  });

  it("skips undefined/null but keeps other values", () => {
    const result = buildQS({ a: 1, b: undefined, c: "x", d: null });
    expect(result).toBe("?a=1&c=x");
  });

  it("handles mixed arrays and scalars", () => {
    const result = buildQS({ page: 1, tags: [10, 20] });
    expect(result).toBe("?page=1&tags=10&tags=20");
  });

  it("handles zero as a valid value", () => {
    expect(buildQS({ offset: 0 })).toBe("?offset=0");
  });

  it("handles empty string as a valid value", () => {
    expect(buildQS({ q: "" })).toBe("?q=");
  });

  it("handles empty array", () => {
    expect(buildQS({ tags: [] })).toBe("");
  });
});

describe("ok", () => {
  it("wraps data in MCP text content format", () => {
    const result = ok({ count: 5 });
    expect(result).toEqual({
      content: [{ type: "text", text: '{\n  "count": 5\n}' }],
    });
  });

  it("handles string data", () => {
    const result = ok("hello");
    expect(result.content[0].text).toBe('"hello"');
  });

  it("handles null", () => {
    const result = ok(null);
    expect(result.content[0].text).toBe("null");
  });

  it("handles arrays", () => {
    const result = ok([1, 2]);
    expect(result.content[0].text).toBe("[\n  1,\n  2\n]");
  });
});

describe("err", () => {
  it("wraps error in MCP error format", () => {
    const result = err(new Error("something broke"));
    expect(result).toEqual({
      content: [{ type: "text", text: "Error: something broke" }],
      isError: true,
    });
  });

  it("handles string errors", () => {
    const result = err("plain string error");
    expect(result.content[0].text).toBe("plain string error");
    expect(result.isError).toBe(true);
  });

  it("handles non-error objects", () => {
    const result = err({ code: 404 });
    expect(result.content[0].text).toBe("[object Object]");
    expect(result.isError).toBe(true);
  });
});

describe("paperlessFetch", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds authorization header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 1 }),
    });

    await paperlessFetch("/api/documents/1/");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/documents/1/",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Token test-token-123",
        }),
      }),
    );
  });

  it("adds content-type for string body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await paperlessFetch("/api/documents/1/", {
      method: "PATCH",
      body: JSON.stringify({ title: "test" }),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("does not add content-type for non-string body", async () => {
    const formData = new FormData();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await paperlessFetch("/api/documents/post_document/", {
      method: "POST",
      body: formData,
    });

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders).not.toHaveProperty("Content-Type");
  });

  it("returns parsed JSON on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ count: 10, results: [] }),
    });

    const result = await paperlessFetch("/api/documents/");
    expect(result).toEqual({ count: 10, results: [] });
  });

  it("returns success object for 204 No Content", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
    });

    const result = await paperlessFetch("/api/documents/1/", { method: "DELETE" });
    expect(result).toEqual({ success: true });
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve("Document not found"),
    });

    await expect(paperlessFetch("/api/documents/999/")).rejects.toThrow(
      "404 Not Found: Document not found",
    );
  });
});

describe("fetchAllPages", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches single page", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        count: 2,
        next: null,
        results: [{ id: 1 }, { id: 2 }],
      }),
    });

    const results = await fetchAllPages("/api/documents/");
    expect(results).toEqual([{ id: 1 }, { id: 2 }]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fetches multiple pages", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          count: 3,
          next: "http://localhost:8000/api/documents/?page=2",
          results: [{ id: 1 }, { id: 2 }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          count: 3,
          next: null,
          results: [{ id: 3 }],
        }),
      });

    const results = await fetchAllPages("/api/documents/");
    expect(results).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("appends page param with & when path has existing query params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        count: 1,
        next: null,
        results: [{ id: 1 }],
      }),
    });

    await fetchAllPages("/api/documents/?ordering=-created");
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("&page=1&page_size=100");
    expect(url).not.toContain("?page=1");
  });
});

describe("getDocumentContent", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns document content", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: "Hello world" }),
    });

    const content = await getDocumentContent(42);
    expect(content).toBe("Hello world");
  });

  it("returns empty string when no content", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    const content = await getDocumentContent(42);
    expect(content).toBe("");
  });
});
