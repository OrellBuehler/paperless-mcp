import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getEventListeners } from "node:events";
import { PaperlessClient } from "../paperless/client.js";

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;
beforeEach(() => {
  fetchMock.mockReset();
});

function jsonRes(body: unknown, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Map(),
  };
}

describe("PaperlessClient.fetch", () => {
  it("calls baseUrl + path with the token header", async () => {
    fetchMock.mockResolvedValue(jsonRes({ ok: true }));
    const c = new PaperlessClient("https://p.example.com", "tok-1");
    expect(await c.fetch("/api/status/")).toEqual({ ok: true });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://p.example.com/api/status/");
    expect((opts.headers as Record<string, string>).Authorization).toBe("Token tok-1");
  });
  it("sets JSON content-type for string bodies", async () => {
    fetchMock.mockResolvedValue(jsonRes({}));
    await new PaperlessClient("https://p.example.com", "t").fetch("/x", {
      method: "PATCH",
      body: "{}",
    });
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });
  it("does not set content-type for FormData bodies", async () => {
    fetchMock.mockResolvedValue(jsonRes({}));
    await new PaperlessClient("https://p.example.com", "t").fetch("/x", {
      method: "POST",
      body: new FormData(),
    });
    expect(
      (fetchMock.mock.calls[0][1].headers as Record<string, string>)["Content-Type"],
    ).toBeUndefined();
  });
  it("returns {success:true} on 204", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      statusText: "No Content",
      json: async () => ({}),
      text: async () => "",
    });
    expect(
      await new PaperlessClient("https://p.example.com", "t").fetch("/x", { method: "DELETE" }),
    ).toEqual({ success: true });
  });
  it("throws status + statusText + body on error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "nope",
    });
    await expect(new PaperlessClient("https://p.example.com", "t").fetch("/x")).rejects.toThrow(
      "403 Forbidden: nope",
    );
  });
  it("calls onUnauthorized only on 401", async () => {
    const c = new PaperlessClient("https://p.example.com", "t");
    c.onUnauthorized = vi.fn();
    fetchMock.mockResolvedValue(jsonRes({}, 403, "Forbidden"));
    await expect(c.fetch("/x")).rejects.toThrow("403");
    expect(c.onUnauthorized).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(jsonRes({}, 401, "Unauthorized"));
    await expect(c.fetch("/x")).rejects.toThrow("401 Unauthorized");
    expect(c.onUnauthorized).toHaveBeenCalledOnce();
  });
  it("strips trailing slashes from baseUrl", async () => {
    fetchMock.mockResolvedValue(jsonRes({}));
    await new PaperlessClient("https://p.example.com///", "t").fetch("/api/status/");
    expect(fetchMock.mock.calls[0][0]).toBe("https://p.example.com/api/status/");
  });
});

describe("PaperlessClient.fetchAllPages", () => {
  it("follows pagination until next is null", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ count: 2, next: "x", previous: null, results: [{ id: 1 }] }))
      .mockResolvedValueOnce(
        jsonRes({ count: 2, next: null, previous: null, results: [{ id: 2 }] }),
      );
    const all = await new PaperlessClient("https://p.example.com", "t").fetchAllPages(
      "/api/documents/",
    );
    expect(all).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchMock.mock.calls[0][0]).toContain("?page=1&page_size=100");
    expect(fetchMock.mock.calls[1][0]).toContain("page=2");
  });
  it("uses & when the path already has a query", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({ count: 1, next: null, previous: null, results: [{ id: 1 }] }),
    );
    await new PaperlessClient("https://p.example.com", "t").fetchAllPages(
      "/api/documents/?ordering=-created",
    );
    expect(fetchMock.mock.calls[0][0]).toContain("&page=1&page_size=100");
  });
});

describe("PaperlessClient.upload / download", () => {
  it("upload posts FormData with the token and no JSON content-type", async () => {
    fetchMock.mockResolvedValue(jsonRes({ task: "t1" }));
    const form = new FormData();
    form.append("title", "x");
    const res = await new PaperlessClient("https://p.example.com", "tok").upload(
      "/api/documents/post_document/",
      form,
    );
    expect(res.ok).toBe(true);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://p.example.com/api/documents/post_document/");
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>).Authorization).toBe("Token tok");
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(opts.body).toBe(form);
  });
  it("download returns the raw Response", async () => {
    const fake = { ok: true, status: 200 };
    fetchMock.mockResolvedValue(fake);
    const res = await new PaperlessClient("https://p.example.com", "tok").download(
      "/api/documents/1/download/",
    );
    expect(res).toBe(fake);
    expect(fetchMock.mock.calls[0][0]).toBe("https://p.example.com/api/documents/1/download/");
  });
  it("download forwards method and body for POST downloads", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await new PaperlessClient("https://p.example.com", "tok").download(
      "/api/documents/bulk_download/",
      { method: "POST", body: JSON.stringify({ documents: [1] }) },
    );
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});

describe("API version pinning", () => {
  it("pins the Accept header to v9 by default", async () => {
    fetchMock.mockResolvedValue(jsonRes({}));
    await new PaperlessClient("https://p.example.com", "tok").fetch("/api/tasks/");
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Accept).toBe(
      "application/json; version=9",
    );
  });
  it("honours an explicit version", async () => {
    fetchMock.mockResolvedValue(jsonRes({}));
    await new PaperlessClient("https://p.example.com", "tok", "10").fetch("/api/tasks/");
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Accept).toBe(
      "application/json; version=10",
    );
  });
  it("omits the Accept header when the version is empty", async () => {
    fetchMock.mockResolvedValue(jsonRes({}));
    await new PaperlessClient("https://p.example.com", "tok", "").fetch("/api/tasks/");
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Accept).toBeUndefined();
  });
  it("pins the version on downloads and uploads too", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const c = new PaperlessClient("https://p.example.com", "tok");
    await c.download("/api/documents/1/download/");
    await c.upload("/api/documents/post_document/", new FormData());
    for (const call of fetchMock.mock.calls) {
      expect((call[1].headers as Record<string, string>).Accept).toBe(
        "application/json; version=9",
      );
    }
  });
});

function hangingFetch(_url: string, opts: RequestInit) {
  return new Promise((_resolve, reject) => {
    opts.signal?.addEventListener("abort", () =>
      reject(new DOMException("This operation was aborted", "AbortError")),
    );
  });
}

describe("timeouts", () => {
  afterEach(() => vi.useRealTimers());

  it("aborts and throws a clear error after timeoutMs", async () => {
    fetchMock.mockImplementation(hangingFetch);
    const c = new PaperlessClient("https://p.example.com", "t", "9", {
      timeoutMs: 20,
      maxRetries: 0,
    });
    await expect(c.fetch("/api/documents/")).rejects.toThrow(
      "Paperless request timed out after 20ms: GET /api/documents/",
    );
  });

  it("applies the timeout to POST requests through fetch", async () => {
    fetchMock.mockImplementation(hangingFetch);
    const c = new PaperlessClient("https://p.example.com", "t", "9", { timeoutMs: 20 });
    await expect(c.fetch("/api/documents/bulk_edit/", { method: "POST" })).rejects.toThrow(
      "timed out after 20ms: POST /api/documents/bulk_edit/",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("applies the timeout to GET downloads", async () => {
    fetchMock.mockImplementation(hangingFetch);
    const c = new PaperlessClient("https://p.example.com", "t", "9", {
      timeoutMs: 20,
      maxRetries: 0,
    });
    await expect(c.download("/api/documents/1/download/")).rejects.toThrow(
      "timed out after 20ms: GET /api/documents/1/download/",
    );
  });

  it("does not time out uploads or POST downloads, but still forwards the caller signal", async () => {
    vi.useFakeTimers();
    const signals: (AbortSignal | null | undefined)[] = [];
    fetchMock.mockImplementation(
      (_url: string, opts: RequestInit) =>
        new Promise((resolve) => {
          signals.push(opts.signal);
          setTimeout(() => resolve({ ok: true, status: 200 }), 600000);
        }),
    );
    const ctrl = new AbortController();
    const c = new PaperlessClient("https://p.example.com", "t", "9", { timeoutMs: 50 });
    const up = c.upload("/api/documents/post_document/", new FormData());
    const bulk = c.download("/api/documents/bulk_download/", {
      method: "POST",
      body: "{}",
      signal: ctrl.signal,
    });
    await vi.advanceTimersByTimeAsync(600000);
    await expect(up).resolves.toMatchObject({ status: 200 });
    await expect(bulk).resolves.toMatchObject({ status: 200 });
    expect(signals).toEqual([undefined, ctrl.signal]);
  });

  it("does not time out when timeoutMs is 0", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, opts: RequestInit) =>
        new Promise((resolve, reject) => {
          opts.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          setTimeout(() => resolve(jsonRes({ ok: 1 })), 120000);
        }),
    );
    const c = new PaperlessClient("https://p.example.com", "t", "9", { timeoutMs: 0 });
    const p = c.fetch("/x");
    await vi.advanceTimersByTimeAsync(120000);
    await expect(p).resolves.toEqual({ ok: 1 });
  });

  it("stops the timer once download headers arrive so the body can stream", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (_url: string, opts: RequestInit) => {
      signal = opts.signal ?? undefined;
      return { ok: true, status: 200 };
    });
    const c = new PaperlessClient("https://p.example.com", "t", "9", { timeoutMs: 50 });
    await c.download("/api/documents/1/download/");
    await vi.advanceTimersByTimeAsync(1000);
    expect(signal?.aborted).toBe(false);
  });

  it("honours a caller abort signal without retrying", async () => {
    fetchMock.mockImplementation(hangingFetch);
    const ctrl = new AbortController();
    const c = new PaperlessClient("https://p.example.com", "t", "9", { timeoutMs: 10000 });
    const p = c.fetch("/x", { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toThrow("aborted");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("combines signals without AbortSignal.any", async () => {
    const original = Object.getOwnPropertyDescriptor(AbortSignal, "any");
    Object.defineProperty(AbortSignal, "any", { value: undefined, configurable: true });
    try {
      fetchMock.mockImplementation(hangingFetch);
      const c = new PaperlessClient("https://p.example.com", "t", "9", {
        timeoutMs: 20,
        maxRetries: 0,
      });
      const caller = new AbortController().signal;
      await expect(c.fetch("/x", { signal: caller })).rejects.toThrow("timed out after 20ms");
      expect(getEventListeners(caller, "abort")).toHaveLength(0);
      const ctrl = new AbortController();
      const p = new PaperlessClient("https://p.example.com", "t").fetch("/x", {
        signal: ctrl.signal,
      });
      ctrl.abort();
      await expect(p).rejects.toThrow("aborted");
    } finally {
      if (original) Object.defineProperty(AbortSignal, "any", original);
    }
  });
});

describe("retries", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const opts = { timeoutMs: 0, maxRetries: 2 };

  async function settle<T>(p: Promise<T>) {
    const result = p.then(
      (v) => ({ v }),
      (e: Error) => ({ e }),
    );
    await vi.runAllTimersAsync();
    return result;
  }

  it("retries GET on 503 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({}, 503, "Service Unavailable"))
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    const c = new PaperlessClient("https://p.example.com", "t", "9", opts);
    expect(await settle(c.fetch("/x"))).toEqual({ v: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on network errors and timeouts with exponential backoff", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockImplementationOnce(hangingFetch)
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    const c = new PaperlessClient("https://p.example.com", "t", "9", {
      timeoutMs: 20,
      maxRetries: 2,
    });
    const p = c.fetch("/x");
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20 + 499);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(p).resolves.toEqual({ ok: true });
  });

  it("retries downloads", async () => {
    const fake = { ok: true, status: 200 };
    fetchMock.mockResolvedValueOnce(jsonRes({}, 502, "Bad Gateway")).mockResolvedValueOnce(fake);
    const c = new PaperlessClient("https://p.example.com", "t", "9", opts);
    expect(await settle(c.download("/api/documents/1/download/"))).toEqual({ v: fake });
  });

  it("gives up after maxRetries and surfaces the last error", async () => {
    fetchMock.mockResolvedValue(jsonRes("busy", 504, "Gateway Timeout"));
    const c = new PaperlessClient("https://p.example.com", "t", "9", opts);
    const r = (await settle(c.fetch("/x"))) as { e: Error };
    expect(r.e.message).toContain("504 Gateway Timeout");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up on repeated network errors", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const c = new PaperlessClient("https://p.example.com", "t", "9", { ...opts, maxRetries: 1 });
    const r = (await settle(c.fetch("/x"))) as { e: Error };
    expect(r.e.message).toBe("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries POST, PATCH, PUT, DELETE or uploads", async () => {
    fetchMock.mockResolvedValue(jsonRes({}, 503, "Service Unavailable"));
    const c = new PaperlessClient("https://p.example.com", "t", "9", opts);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const r = (await settle(c.fetch("/x", { method, body: "{}" }))) as { e: Error };
      expect(r.e.message).toContain("503");
    }
    const res = (await settle(c.upload("/api/documents/post_document/", new FormData()))) as {
      v: Response;
    };
    expect(res.v.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("never retries 401 or other 4xx, and onUnauthorized still fires once", async () => {
    const c = new PaperlessClient("https://p.example.com", "t", "9", opts);
    c.onUnauthorized = vi.fn();
    fetchMock.mockResolvedValue(jsonRes({}, 401, "Unauthorized"));
    expect(((await settle(c.fetch("/x"))) as { e: Error }).e.message).toContain("401");
    expect(c.onUnauthorized).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValue(jsonRes({}, 400, "Bad Request"));
    expect(((await settle(c.fetch("/x"))) as { e: Error }).e.message).toContain("400");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when maxRetries is 0", async () => {
    fetchMock.mockResolvedValue(jsonRes({}, 503, "Service Unavailable"));
    const c = new PaperlessClient("https://p.example.com", "t", "9", { maxRetries: 0 });
    await expect(c.fetch("/x")).rejects.toThrow("503");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  function withRetryAfter(value: string) {
    return { ...jsonRes({}, 429, "Too Many Requests"), headers: new Map([["retry-after", value]]) };
  }

  it("honours Retry-After in seconds", async () => {
    fetchMock.mockResolvedValueOnce(withRetryAfter("3")).mockResolvedValueOnce(jsonRes({ ok: 1 }));
    const c = new PaperlessClient("https://p.example.com", "t", "9", opts);
    const p = c.fetch("/x");
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(p).resolves.toEqual({ ok: 1 });
  });

  it("honours Retry-After as an HTTP date", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    fetchMock
      .mockResolvedValueOnce(withRetryAfter("Thu, 01 Jan 2026 00:00:02 GMT"))
      .mockResolvedValueOnce(jsonRes({ ok: 1 }));
    const c = new PaperlessClient("https://p.example.com", "t", "9", opts);
    const p = c.fetch("/x");
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(p).resolves.toEqual({ ok: 1 });
  });

  it("caps Retry-After at 10s", async () => {
    fetchMock
      .mockResolvedValueOnce(withRetryAfter("3600"))
      .mockResolvedValueOnce(jsonRes({ ok: 1 }));
    const c = new PaperlessClient("https://p.example.com", "t", "9", opts);
    const p = c.fetch("/x");
    await vi.advanceTimersByTimeAsync(9999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(p).resolves.toEqual({ ok: 1 });
  });
});
