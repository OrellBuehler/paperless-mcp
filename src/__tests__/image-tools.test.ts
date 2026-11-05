import { describe, it, expect, vi, afterEach } from "vitest";

vi.stubEnv("PAPERLESS_URL", "http://localhost:8000");
vi.stubEnv("PAPERLESS_TOKEN", "test-token-123");

const { registerDocumentTools } = await import("../tools/documents.js");
const { registerCoreTools } = await import("../tools/core.js");
const { PaperlessClient } = await import("../paperless/client.js");

type ToolResult = {
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  isError?: boolean;
};
type ToolHandler = (args: any) => Promise<ToolResult>;

const client = new PaperlessClient("http://localhost:8000", "test-token-123");
const tools = new Map<string, ToolHandler>();
const server = {
  tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
    tools.set(name, handler);
  },
};
registerDocumentTools(server as any, client);
registerCoreTools(server as any, client);

const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03]);

describe("get_document_thumbnail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the thumbnail as base64 image content", async () => {
    const dl = vi
      .spyOn(client, "download")
      .mockResolvedValue(new Response(bytes, { headers: { "content-type": "image/webp" } }));
    const result = await tools.get("get_document_thumbnail")!({ id: 7 });
    expect(dl).toHaveBeenCalledWith("/api/documents/7/thumb/");
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      { type: "image", data: bytes.toString("base64"), mimeType: "image/webp" },
    ]);
  });

  it("uses the response content type for older png thumbnails", async () => {
    vi.spyOn(client, "download").mockResolvedValue(
      new Response(bytes, { headers: { "content-type": "image/png; charset=binary" } }),
    );
    const result = await tools.get("get_document_thumbnail")!({ id: 7 });
    expect(result.content[0].mimeType).toBe("image/png");
  });

  it("falls back to image/webp when no content type is sent", async () => {
    const res = new Response(bytes);
    res.headers.delete("content-type");
    vi.spyOn(client, "download").mockResolvedValue(res);
    const result = await tools.get("get_document_thumbnail")!({ id: 7 });
    expect(result.content[0].mimeType).toBe("image/webp");
  });

  it("returns an error on non-2xx", async () => {
    vi.spyOn(client, "download").mockResolvedValue(
      new Response("nope", { status: 404, statusText: "Not Found" }),
    );
    const result = await tools.get("get_document_thumbnail")!({ id: 7 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("404");
  });
});

describe("download_document images", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns image documents as image content", async () => {
    const dl = vi
      .spyOn(client, "download")
      .mockResolvedValue(new Response(bytes, { headers: { "content-type": "image/jpeg" } }));
    const result = await tools.get("download_document")!({ id: 3, original: true });
    expect(dl).toHaveBeenCalledWith("/api/documents/3/download/?original=true");
    expect(result.content).toEqual([
      { type: "image", data: bytes.toString("base64"), mimeType: "image/jpeg" },
    ]);
  });

  it("strips parameters from the image content type", async () => {
    vi.spyOn(client, "download").mockResolvedValue(
      new Response(bytes, { headers: { "content-type": "image/png; charset=binary" } }),
    );
    const result = await tools.get("download_document")!({ id: 3 });
    expect(result.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
  });

  it("returns the binary summary for unsupported image types like TIFF", async () => {
    vi.spyOn(client, "download").mockResolvedValue(
      new Response(bytes, { headers: { "content-type": "image/tiff" } }),
    );
    const result = await tools.get("download_document")!({ id: 3, original: true });
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text!)).toMatchObject({
      content_type: "image/tiff",
      size: bytes.length,
    });
  });

  it("rejects images over the size cap", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1);
    vi.spyOn(client, "download").mockResolvedValue(
      new Response(big, { headers: { "content-type": "image/png" } }),
    );
    const result = await tools.get("download_document")!({ id: 3 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("get_document_thumbnail");
  });

  it("rejects by content-length before reading the body", async () => {
    const res = new Response(bytes, {
      headers: { "content-type": "image/png", "content-length": String(6 * 1024 * 1024) },
    });
    const read = vi.spyOn(res, "arrayBuffer");
    vi.spyOn(client, "download").mockResolvedValue(res);
    const result = await tools.get("download_document")!({ id: 3 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("6291456 bytes");
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps the binary summary for PDFs", async () => {
    vi.spyOn(client, "download").mockResolvedValue(
      new Response(bytes, { headers: { "content-type": "application/pdf" } }),
    );
    const result = await tools.get("download_document")!({ id: 3 });
    expect(JSON.parse(result.content[0].text!)).toMatchObject({
      content_type: "application/pdf",
      size: bytes.length,
    });
  });
});
