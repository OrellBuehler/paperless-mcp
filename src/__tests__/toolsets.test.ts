import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("../embeddings.js", () => ({
  embed: vi.fn(),
  embedSingle: vi.fn(),
  getProviderInfo: () => ({ provider: "openai", model: "m", dimensions: 3 }),
}));
vi.mock("../vectordb.js", () => ({
  searchSimilar: vi.fn(),
  getStats: () => ({ indexed_documents: 0, db_path: "/tmp/x" }),
  upsertDocument: vi.fn(),
  getIndexedDocIds: () => [],
  getDocumentHash: () => null,
  removeDocument: vi.fn(),
}));

function stubEnv(env: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv("PAPERLESS_URL", "https://p.example.com");
  vi.stubEnv("PAPERLESS_TOKEN", "admin-tok");
  vi.stubEnv("EMBEDDINGS_ENABLED", "true");
  vi.stubEnv("PAPERLESS_TOOLSETS", "");
  vi.stubEnv("PAPERLESS_READ_ONLY", "");
  vi.stubEnv("PAPERLESS_DISABLED_TOOLS", "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

async function connect(env: Record<string, string> = {}, token = "admin-tok") {
  stubEnv(env);
  const { createServer } = await import("../server.js");
  const { clientFor } = await import("../config.js");
  const { toolAnnotations } = await import("../tools/annotations.js");
  const server = await createServer(clientFor(token));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  return { client, tools, names: tools.map((t) => t.name).sort(), toolAnnotations };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("tool annotations", () => {
  it("classifies every registered tool and has no stale entries", async () => {
    const { tools, names, toolAnnotations } = await connect();
    expect(names).toEqual(Object.keys(toolAnnotations).sort());
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toEqual(toolAnnotations[tool.name]);
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        expect(typeof (tool.annotations as Record<string, unknown>)[hint], tool.name).toBe(
          "boolean",
        );
      }
    }
  });

  it("marks reads, deletes and external tools as expected", async () => {
    const { toolAnnotations } = await connect();
    expect(toolAnnotations.list_documents.readOnlyHint).toBe(true);
    expect(toolAnnotations.test_storage_path.readOnlyHint).toBe(true);
    expect(toolAnnotations.sync_embeddings.readOnlyHint).toBe(false);
    expect(toolAnnotations.delete_document.destructiveHint).toBe(true);
    expect(toolAnnotations.empty_trash.destructiveHint).toBe(true);
    expect(toolAnnotations.create_tag.destructiveHint).toBe(false);
    expect(toolAnnotations.upload_from_url.openWorldHint).toBe(true);
    expect(toolAnnotations.email_documents.openWorldHint).toBe(true);
    expect(toolAnnotations.get_document.openWorldHint).toBe(false);
    expect(toolAnnotations.run_task.openWorldHint).toBe(true);
  });
});

describe("server version", () => {
  it("reports the package.json version", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    const { client } = await connect();
    expect(client.getServerVersion()).toEqual({ name: "paperless-mcp", version: pkg.version });
  });
});

describe("tool filtering", () => {
  it("keeps sync_embeddings admin-only", async () => {
    const { names } = await connect({}, "user-tok");
    expect(names).toContain("semantic_search");
    expect(names).not.toContain("sync_embeddings");
  });

  it("PAPERLESS_READ_ONLY registers only read-only tools", async () => {
    const { tools, names, toolAnnotations } = await connect({ PAPERLESS_READ_ONLY: "true" });
    const expected = Object.keys(toolAnnotations)
      .filter((n) => toolAnnotations[n].readOnlyHint)
      .sort();
    expect(names).toEqual(expected);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(names).not.toContain("delete_document");
  });

  it("PAPERLESS_TOOLSETS limits the registered groups", async () => {
    const { names } = await connect({ PAPERLESS_TOOLSETS: "system, search" });
    expect(names).toContain("get_config");
    expect(names).toContain("semantic_search");
    expect(names).not.toContain("list_documents");
    expect(names).not.toContain("list_users");
  });

  it("skips search tools when the search toolset is not selected", async () => {
    const { names } = await connect({ PAPERLESS_TOOLSETS: "core" });
    expect(names).toContain("list_documents");
    expect(names).not.toContain("semantic_search");
    expect(names).not.toContain("get_config");
  });

  it("PAPERLESS_DISABLED_TOOLS skips named tools", async () => {
    const { names } = await connect({ PAPERLESS_DISABLED_TOOLS: "delete_document, empty_trash" });
    expect(names).not.toContain("delete_document");
    expect(names).not.toContain("empty_trash");
    expect(names).toContain("get_document");
  });

  it("exits on unknown toolsets, listing the valid names", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    await expect(connect({ PAPERLESS_TOOLSETS: "core,bogus" })).rejects.toThrow("exit 1");
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/bogus.*core, workflow.*search/));
  });
});

describe("checkToolSelection", () => {
  function mockExit() {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    return { error, exit };
  }

  it("passes for a selection with tools and warns about unknown disabled tools", async () => {
    const { error, exit } = mockExit();
    stubEnv({ PAPERLESS_DISABLED_TOOLS: "delete_document, not_a_tool" });
    const { checkToolSelection } = await import("../server.js");
    await checkToolSelection();
    expect(exit).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("not_a_tool"));
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining("delete_document"));
  });

  it("warns when search is selected without embeddings and exits when nothing is left", async () => {
    const { error } = mockExit();
    stubEnv({ PAPERLESS_TOOLSETS: "search", EMBEDDINGS_ENABLED: "false" });
    const { checkToolSelection } = await import("../server.js");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("EMBEDDINGS_ENABLED=true"));
    await expect(checkToolSelection()).rejects.toThrow("exit 1");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("No tools left to register"));
  });

  it("does not warn about search when PAPERLESS_TOOLSETS is unset", async () => {
    const { error } = mockExit();
    stubEnv({ EMBEDDINGS_ENABLED: "false" });
    await import("../config.js");
    expect(error).not.toHaveBeenCalled();
  });

  it("exits when the read-only and disabled filters leave no tools", async () => {
    mockExit();
    stubEnv({
      PAPERLESS_TOOLSETS: "automation",
      PAPERLESS_READ_ONLY: "true",
      PAPERLESS_DISABLED_TOOLS: "list_workflows,get_workflow",
    });
    const { checkToolSelection } = await import("../server.js");
    await expect(checkToolSelection()).rejects.toThrow("exit 1");
  });

  it("passes when the filters leave at least one tool", async () => {
    const { exit } = mockExit();
    stubEnv({
      PAPERLESS_TOOLSETS: "automation",
      PAPERLESS_READ_ONLY: "true",
      PAPERLESS_DISABLED_TOOLS: "list_workflows",
    });
    const { checkToolSelection } = await import("../server.js");
    await checkToolSelection();
    expect(exit).not.toHaveBeenCalled();
  });
});
