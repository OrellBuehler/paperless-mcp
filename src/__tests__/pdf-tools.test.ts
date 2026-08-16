import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

vi.stubEnv("PAPERLESS_URL", "http://localhost:8000");
vi.stubEnv("PAPERLESS_TOKEN", "test-token-123");

const { registerDocumentTools } = await import("../tools/documents.js");
const { PaperlessClient } = await import("../paperless/client.js");

type ToolHandler = (args: any) => Promise<{ content: { text: string }[]; isError?: boolean }>;

const client = new PaperlessClient("http://localhost:8000", "test-token-123");
const tools = new Map<string, ToolHandler>();
const server = {
  tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
    tools.set(name, handler);
  },
};
registerDocumentTools(server as any, client);

async function makePdf(pageTexts: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pageTexts) {
    const page = doc.addPage([300, 300]);
    page.drawText(text, { x: 20, y: 150, size: 12, font });
  }
  return doc.save();
}

function pdfResponse(bytes: Uint8Array) {
  return new Response(Buffer.from(bytes), {
    headers: { "content-type": "application/pdf" },
  });
}

function parseResult(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

describe("pdf page tools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers both tools", () => {
    expect(tools.has("extract_document_pages")).toBe(true);
    expect(tools.has("find_document_pages")).toBe(true);
  });

  it("extract_document_pages writes the requested pages in order", async () => {
    const bytes = await makePdf(["page one", "page two", "page three"]);
    const dl = vi.spyOn(client, "download").mockResolvedValue(pdfResponse(bytes));
    const dir = await mkdtemp(join(tmpdir(), "pdf-tools-"));
    const output_path = join(dir, "out.pdf");

    const result = await tools.get("extract_document_pages")!({
      id: 5,
      pages: [3, 1],
      output_path,
    });

    expect(dl).toHaveBeenCalledWith("/api/documents/5/download/");
    expect(result.isError).toBeUndefined();
    expect(parseResult(result)).toMatchObject({ path: output_path, pages: [3, 1], total_pages: 3 });
    const written = await PDFDocument.load(await readFile(output_path));
    expect(written.getPageCount()).toBe(2);
  });

  it("extract_document_pages passes the original flag", async () => {
    const bytes = await makePdf(["only page"]);
    const dl = vi.spyOn(client, "download").mockResolvedValue(pdfResponse(bytes));
    const dir = await mkdtemp(join(tmpdir(), "pdf-tools-"));

    await tools.get("extract_document_pages")!({
      id: 9,
      pages: [1],
      output_path: join(dir, "orig.pdf"),
      original: true,
    });

    expect(dl).toHaveBeenCalledWith("/api/documents/9/download/?original=true");
  });

  it("extract_document_pages errors on out-of-range pages", async () => {
    const bytes = await makePdf(["page one", "page two"]);
    vi.spyOn(client, "download").mockResolvedValue(pdfResponse(bytes));
    const dir = await mkdtemp(join(tmpdir(), "pdf-tools-"));

    const result = await tools.get("extract_document_pages")!({
      id: 5,
      pages: [1, 4],
      output_path: join(dir, "bad.pdf"),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("out of range: 4");
  });

  it("extract_document_pages errors on non-PDF content", async () => {
    vi.spyOn(client, "download").mockResolvedValue(
      new Response("hello", { headers: { "content-type": "text/plain" } }),
    );
    const dir = await mkdtemp(join(tmpdir(), "pdf-tools-"));

    const result = await tools.get("extract_document_pages")!({
      id: 5,
      pages: [1],
      output_path: join(dir, "nope.pdf"),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not a PDF");
  });

  it("find_document_pages returns matching pages with snippets", async () => {
    const bytes = await makePdf([
      "Invoice from ACME Corp",
      "Total amount 42.50 CHF",
      "Terms and conditions apply",
    ]);
    const dl = vi.spyOn(client, "download").mockResolvedValue(pdfResponse(bytes));

    const result = await tools.get("find_document_pages")!({ id: 7, query: "Total Amount" });

    expect(dl).toHaveBeenCalledWith("/api/documents/7/download/");
    expect(result.isError).toBeUndefined();
    const data = parseResult(result);
    expect(data.total_pages).toBe(3);
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0].page).toBe(2);
    expect(data.matches[0].snippet).toContain("total amount 42.50");
  });

  it("find_document_pages returns no matches for absent text", async () => {
    const bytes = await makePdf(["page one", "page two"]);
    vi.spyOn(client, "download").mockResolvedValue(pdfResponse(bytes));

    const result = await tools.get("find_document_pages")!({ id: 7, query: "nonexistent" });

    expect(parseResult(result).matches).toEqual([]);
  });
});
