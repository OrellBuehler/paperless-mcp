import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaperlessClient } from "../paperless/client.js";

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;
beforeEach(() => fetchMock.mockReset());

function jsonRes(body: unknown, status = 200, statusText = "OK") {
  return { ok: status >= 200 && status < 300, status, statusText, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() };
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
    await new PaperlessClient("https://p.example.com", "t").fetch("/x", { method: "PATCH", body: "{}" });
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
  it("does not set content-type for FormData bodies", async () => {
    fetchMock.mockResolvedValue(jsonRes({}));
    await new PaperlessClient("https://p.example.com", "t").fetch("/x", { method: "POST", body: new FormData() });
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });
  it("returns {success:true} on 204", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, statusText: "No Content", json: async () => ({}), text: async () => "" });
    expect(await new PaperlessClient("https://p.example.com", "t").fetch("/x", { method: "DELETE" })).toEqual({ success: true });
  });
  it("throws status + statusText + body on error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden", text: async () => "nope" });
    await expect(new PaperlessClient("https://p.example.com", "t").fetch("/x")).rejects.toThrow("403 Forbidden: nope");
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
      .mockResolvedValueOnce(jsonRes({ count: 2, next: null, previous: null, results: [{ id: 2 }] }));
    const all = await new PaperlessClient("https://p.example.com", "t").fetchAllPages("/api/documents/");
    expect(all).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchMock.mock.calls[0][0]).toContain("?page=1&page_size=100");
    expect(fetchMock.mock.calls[1][0]).toContain("page=2");
  });
  it("uses & when the path already has a query", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ count: 1, next: null, previous: null, results: [{ id: 1 }] }));
    await new PaperlessClient("https://p.example.com", "t").fetchAllPages("/api/documents/?ordering=-created");
    expect(fetchMock.mock.calls[0][0]).toContain("&page=1&page_size=100");
  });
});

describe("PaperlessClient.upload / download", () => {
  it("upload posts FormData with the token and no JSON content-type", async () => {
    fetchMock.mockResolvedValue(jsonRes({ task: "t1" }));
    const form = new FormData(); form.append("title", "x");
    const res = await new PaperlessClient("https://p.example.com", "tok").upload("/api/documents/post_document/", form);
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
    const res = await new PaperlessClient("https://p.example.com", "tok").download("/api/documents/1/download/");
    expect(res).toBe(fake);
    expect(fetchMock.mock.calls[0][0]).toBe("https://p.example.com/api/documents/1/download/");
  });
});
