import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.stubEnv("PAPERLESS_URL", "http://localhost:8000");
vi.stubEnv("PAPERLESS_TOKEN", "test-token-123");

const { registerAutomationTools } = await import("../tools/automation.js");
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
  registerAutomationTools(server as any, client);
  return tools;
}

const tools = collectTools();

function mockJson(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

describe("workflow tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers all workflow tools", () => {
    for (const name of ["list_workflows", "get_workflow", "create_workflow", "update_workflow"]) {
      expect(tools.has(name)).toBe(true);
    }
  });

  it("create_workflow POSTs name with inline triggers and actions", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 1 }));
    const triggers = [{ type: 1, sources: [1], filter_filename: "*.pdf" }];
    const actions = [{ type: 1, assign_tags: [5] }];
    await tools.get("create_workflow")!({ name: "Tag PDFs", order: 1, enabled: true, triggers, actions });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/workflows/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Tag PDFs", order: 1, enabled: true, triggers, actions }),
      }),
    );
  });

  it("update_workflow PATCHes the id endpoint without the id in the body", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 1 }));
    await tools.get("update_workflow")!({ id: 1, enabled: false });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/workflows/1/",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) }),
    );
  });

  it("get_workflow GETs the id endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 1 }));
    await tools.get("get_workflow")!({ id: 1 });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/workflows/1/",
      expect.any(Object),
    );
  });

  it("returns an MCP error result when the API call fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: () => Promise.resolve("invalid trigger"),
    });
    const res = await tools.get("create_workflow")!({ name: "x" });
    expect(res.isError).toBe(true);
  });
});
