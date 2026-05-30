import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("PAPERLESS_URL", "https://p.example.com");
vi.stubEnv("PAPERLESS_TOKEN", "admin-tok");

const { registerCoreTools } = await import("../tools/core.js");
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
