import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.stubEnv("PAPERLESS_URL", "http://localhost:8000");
vi.stubEnv("PAPERLESS_TOKEN", "test-token-123");

const { registerMailTools } = await import("../tools/mail.js");
const { registerSharingTools } = await import("../tools/sharing.js");
const { registerSystemTools } = await import("../tools/system.js");
const { registerDocumentTools } = await import("../tools/documents.js");
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
  registerMailTools(server as any, client);
  registerSharingTools(server as any, client);
  registerSystemTools(server as any, client);
  registerDocumentTools(server as any, client);
  return tools;
}

const tools = collectTools();

function mockJson(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function lastCall(mockFetch: ReturnType<typeof vi.fn>) {
  const [url, opts] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return {
    url: String(url),
    opts: opts ?? {},
    body: opts?.body ? JSON.parse(opts.body) : undefined,
  };
}

describe("new tool groups", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue(mockJson({ ok: true }));
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers every new tool", () => {
    for (const name of [
      "list_mail_accounts",
      "create_mail_account",
      "update_mail_account",
      "test_mail_account",
      "process_mail_account",
      "list_mail_rules",
      "create_mail_rule",
      "list_processed_mail",
      "list_share_links",
      "create_share_link",
      "get_document_share_links",
      "list_share_link_bundles",
      "create_share_link_bundle",
      "rebuild_share_link_bundle",
      "email_document",
      "email_documents",
      "get_config",
      "update_config",
      "get_ui_settings",
      "get_profile",
      "get_remote_version",
      "list_logs",
      "get_log",
      "list_trash",
      "restore_from_trash",
      "empty_trash",
      "acknowledge_tasks",
      "run_task",
      "get_task_summary",
      "get_task_status_counts",
      "get_active_tasks",
      "get_document_history",
      "get_document_ai_suggestions",
      "get_document_root",
      "upload_document_version",
      "set_document_version_label",
      "delete_document_version",
      "get_selection_data",
      "bulk_download_documents",
      "test_storage_path",
      "rotate_documents",
      "merge_documents",
      "edit_pdf_document",
      "remove_document_password",
      "reprocess_documents",
    ]) {
      expect(tools.has(name), `missing tool: ${name}`).toBe(true);
    }
  });

  it("create_mail_account POSTs to /api/mail_accounts/", async () => {
    await tools.get("create_mail_account")!({
      name: "Gmail",
      imap_server: "imap.gmail.com",
      username: "me",
      password: "pw",
      imap_security: 2,
    });
    const { url, opts, body } = lastCall(mockFetch);
    expect(url).toBe("http://localhost:8000/api/mail_accounts/");
    expect(opts.method).toBe("POST");
    expect(body).toEqual({
      name: "Gmail",
      imap_server: "imap.gmail.com",
      username: "me",
      password: "pw",
      imap_security: 2,
    });
  });

  it("update_mail_rule PATCHes and drops the id from the body", async () => {
    await tools.get("update_mail_rule")!({ id: 7, name: "Renamed", action: 3 });
    const { url, opts, body } = lastCall(mockFetch);
    expect(url).toBe("http://localhost:8000/api/mail_rules/7/");
    expect(opts.method).toBe("PATCH");
    expect(body).toEqual({ name: "Renamed", action: 3 });
  });

  it("process_mail_account POSTs to the process action", async () => {
    await tools.get("process_mail_account")!({ id: 3 });
    const { url, opts } = lastCall(mockFetch);
    expect(url).toBe("http://localhost:8000/api/mail_accounts/3/process/");
    expect(opts.method).toBe("POST");
  });

  it("create_share_link POSTs the document and file version", async () => {
    await tools.get("create_share_link")!({ document: 12, file_version: "original" });
    const { url, body } = lastCall(mockFetch);
    expect(url).toBe("http://localhost:8000/api/share_links/");
    expect(body).toEqual({ document: 12, file_version: "original" });
  });

  it("email_document posts to the per-document email action without the id in the body", async () => {
    await tools.get("email_document")!({
      id: 42,
      addresses: "a@example.com",
      subject: "Hi",
      message: "See attached",
    });
    const { url, body } = lastCall(mockFetch);
    expect(url).toBe("http://localhost:8000/api/documents/42/email/");
    expect(body).toEqual({ addresses: "a@example.com", subject: "Hi", message: "See attached" });
  });

  it("restore_from_trash sends the restore action", async () => {
    await tools.get("restore_from_trash")!({ documents: [1, 2] });
    const { url, body } = lastCall(mockFetch);
    expect(url).toBe("http://localhost:8000/api/trash/");
    expect(body).toEqual({ action: "restore", documents: [1, 2] });
  });

  it("empty_trash omits documents when purging everything", async () => {
    await tools.get("empty_trash")!({});
    expect(lastCall(mockFetch).body).toEqual({ action: "empty" });
  });

  it("empty_trash scopes to the given documents when provided", async () => {
    await tools.get("empty_trash")!({ documents: [9] });
    expect(lastCall(mockFetch).body).toEqual({ action: "empty", documents: [9] });
  });

  it("get_task_summary passes the days window as a query param", async () => {
    await tools.get("get_task_summary")!({ days: 7 });
    expect(lastCall(mockFetch).url).toBe("http://localhost:8000/api/tasks/summary/?days=7");
  });

  it("update_config PATCHes /api/config/{id}/ without the id in the body", async () => {
    await tools.get("update_config")!({ id: 1, language: "deu" });
    const { url, opts, body } = lastCall(mockFetch);
    expect(url).toBe("http://localhost:8000/api/config/1/");
    expect(opts.method).toBe("PATCH");
    expect(body).toEqual({ language: "deu" });
  });

  it("delete_document_version DELETEs the nested version route", async () => {
    await tools.get("delete_document_version")!({ id: 5, version_id: 2 });
    const { url, opts } = lastCall(mockFetch);
    expect(url).toBe("http://localhost:8000/api/documents/5/versions/2/");
    expect(opts.method).toBe("DELETE");
  });

  it("set_document_version_label PATCHes the nested version route", async () => {
    await tools.get("set_document_version_label")!({
      id: 5,
      version_id: 2,
      version_label: "signed",
    });
    const { url, opts, body } = lastCall(mockFetch);
    expect(url).toBe("http://localhost:8000/api/documents/5/versions/2/");
    expect(opts.method).toBe("PATCH");
    expect(body).toEqual({ version_label: "signed" });
  });

  it("test_storage_path posts the template and target document", async () => {
    await tools.get("test_storage_path")!({ path: "{created_year}/{title}", document: 4 });
    const { url, body } = lastCall(mockFetch);
    expect(url).toBe("http://localhost:8000/api/storage_paths/test/");
    expect(body).toEqual({ path: "{created_year}/{title}", document: 4 });
  });

  it("rotate_documents posts to the dedicated rotate endpoint", async () => {
    await tools.get("rotate_documents")!({ documents: [1], degrees: 90 });
    const { url, body } = lastCall(mockFetch);
    expect(url).toBe("http://localhost:8000/api/documents/rotate/");
    expect(body).toEqual({ documents: [1], degrees: 90 });
  });

  it("merge_documents posts to the dedicated merge endpoint", async () => {
    await tools.get("merge_documents")!({ documents: [1, 2], delete_originals: true });
    const { url, body } = lastCall(mockFetch);
    expect(url).toBe("http://localhost:8000/api/documents/merge/");
    expect(body).toEqual({ documents: [1, 2], delete_originals: true });
  });

  it("get_selection_data posts the document list", async () => {
    await tools.get("get_selection_data")!({ documents: [1, 2, 3] });
    const { url, body } = lastCall(mockFetch);
    expect(url).toBe("http://localhost:8000/api/documents/selection_data/");
    expect(body).toEqual({ documents: [1, 2, 3] });
  });

  it("surfaces API errors as isError results", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: () => Promise.resolve("nope"),
    });
    const res = await tools.get("get_config")!({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("403");
  });
});
