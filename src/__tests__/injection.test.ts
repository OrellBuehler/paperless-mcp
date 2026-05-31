import { describe, it, expect, vi } from "vitest";

vi.stubEnv("PAPERLESS_URL", "https://p.example.com");
vi.stubEnv("PAPERLESS_TOKEN", "admin-tok");

const { registerCoreTools } = await import("../tools/core.js");
const { registerHelperTools } = await import("../tools/helpers.js");
const { registerWorkflowTools } = await import("../tools/workflow.js");
const { PaperlessClient } = await import("../paperless/client.js");

type H = (a: any) => Promise<{ content: { text: string }[]; isError?: boolean }>;
function collect(reg: (s: any, c: InstanceType<typeof PaperlessClient>) => void, c: InstanceType<typeof PaperlessClient>) {
  const t = new Map<string, H>();
  reg({ tool: (n: string, _d: string, _s: unknown, h: H) => t.set(n, h) } as any, c);
  return t;
}

describe("core tools use the injected client", () => {
  it("get_status calls client.fetch", async () => {
    const c = new PaperlessClient("https://p.example.com", "user-tok");
    const calls: string[] = [];
    (c as any).fetch = async (p: string) => { calls.push(p); return { status: "OK" }; };
    const t = collect(registerCoreTools, c);
    await t.get("get_status")!({});
    expect(calls).toEqual(["/api/status/"]);
  });

  it("download_document calls client.download", async () => {
    const c = new PaperlessClient("https://p.example.com", "user-tok");
    let path = "";
    (c as any).download = async (p: string) => { path = p; return { ok: true, headers: new Map([["content-type", "text/plain"]]), text: async () => "hi" }; };
    const t = collect(registerCoreTools, c);
    const res = await t.get("download_document")!({ id: 5 });
    expect(path).toBe("/api/documents/5/download/");
    expect(res.content[0].text).toContain("hi");
  });
});

describe("helper tools use the injected client", () => {
  it("get_documents calls client.fetch per id", async () => {
    const c = new PaperlessClient("https://p.example.com", "user-tok");
    const calls: string[] = [];
    (c as any).fetch = async (p: string) => { calls.push(p); return { id: Number(p.split("/")[3]), content: "x" }; };
    const t = collect(registerHelperTools, c);
    await t.get("get_documents")!({ ids: [1, 2] });
    expect(calls).toEqual(["/api/documents/1/", "/api/documents/2/"]);
  });

  it("upload_from_url calls client.upload", async () => {
    const c = new PaperlessClient("https://p.example.com", "user-tok");
    let uploaded = false;
    (c as any).upload = async () => { uploaded = true; return { ok: true, json: async () => ({ task: "t" }), headers: new Map() }; };
    const realFetch = global.fetch;
    global.fetch = (async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-length", "10"]]),
      blob: async () => new Blob(["data"]),
    })) as unknown as typeof fetch;
    try {
      const t = collect(registerHelperTools, c);
      const res = await t.get("upload_from_url")!({ url: "https://example.com/file.pdf" });
      expect(uploaded).toBe(true);
      expect(res.isError).toBeFalsy();
    } finally {
      global.fetch = realFetch;
    }
  });
});

describe("workflow tools use the injected client", () => {
  it("process_inbox queries documents via client.fetch", async () => {
    const c = new PaperlessClient("https://p.example.com", "user-tok");
    const calls: string[] = [];
    (c as any).fetch = async (p: string) => { calls.push(p); return { count: 0, results: [] }; };
    const t = collect(registerWorkflowTools, c);
    await t.get("process_inbox")!({});
    expect(calls[0]).toContain("/api/documents/");
    expect(calls[0]).toContain("is_in_inbox=true");
  });
});
