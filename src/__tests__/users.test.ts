import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.stubEnv("PAPERLESS_URL", "http://localhost:8000");
vi.stubEnv("PAPERLESS_TOKEN", "test-token-123");

const { registerUserTools } = await import("../tools/users.js");
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
  registerUserTools(server as any, client);
  return tools;
}

const tools = collectTools();

function mockJson(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

describe("user & group tools", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers all user and group tools", () => {
    for (const name of [
      "list_users", "get_user", "create_user", "update_user",
      "list_groups", "get_group", "create_group", "update_group",
    ]) {
      expect(tools.has(name)).toBe(true);
    }
  });

  it("create_user POSTs the body", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 2 }));
    await tools.get("create_user")!({ username: "andri", password: "pw", groups: [1] });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/users/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "andri", password: "pw", groups: [1] }),
      }),
    );
  });

  it("update_user PATCHes the id endpoint without the id in the body", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 2 }));
    await tools.get("update_user")!({ id: 2, is_superuser: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/users/2/",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ is_superuser: true }) }),
    );
  });

  it("create_group POSTs name and permissions", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 3 }));
    await tools.get("create_group")!({ name: "household", permissions: ["documents.view_document"] });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/groups/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "household", permissions: ["documents.view_document"] }),
      }),
    );
  });

  it("update_group PATCHes the id endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 3 }));
    await tools.get("update_group")!({ id: 3, name: "family" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/groups/3/",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "family" }) }),
    );
  });

  it("get_user GETs the id endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJson({ id: 2 }));
    await tools.get("get_user")!({ id: 2 });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/users/2/",
      expect.any(Object),
    );
  });

  it("returns an MCP error result when the API call fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: () => Promise.resolve("permission denied"),
    });
    const res = await tools.get("create_user")!({ username: "x" });
    expect(res.isError).toBe(true);
  });
});
