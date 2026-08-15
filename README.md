# paperless-mcp

[![npm version](https://img.shields.io/npm/v/@orellbuehler/paperless-mcp)](https://www.npmjs.com/package/@orellbuehler/paperless-mcp)
[![CI](https://github.com/OrellBuehler/paperless-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/OrellBuehler/paperless-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@orellbuehler/paperless-mcp)](LICENSE)
[![node](https://img.shields.io/node/v/@orellbuehler/paperless-mcp)](package.json)

Connect AI agents to [Paperless-ngx](https://docs.paperless-ngx.com/). This [Model Context Protocol](https://modelcontextprotocol.io/) server exposes the Paperless-ngx REST API as 115+ tools, so assistants like Claude can search, upload, tag, and organize your documents — with optional semantic search over your whole archive using local vector embeddings.

Works with any MCP client: Claude Code, Claude Desktop, or your own agent.

## Highlights

- **Full document management** — search, upload, download, update, and bulk-edit documents; manage tags, correspondents, document types, storage paths, custom fields, and saved views
- **Semantic search (optional)** — vector similarity search with OpenAI or Ollama embeddings, stored locally in sqlite-vec; no external vector DB
- **AI-assisted workflows** — auto-classify documents, process your inbox, bulk-tag by content
- **Mail, sharing, and trash** — configure mail accounts and rules, create public share links, email documents, and restore from the trash
- **Paperless-ngx 3.0 ready** — document versions, PDF editing, share bundles, and task management, with the REST API version pinned so 2.x and 3.x both behave predictably
- **Single- or multi-user** — stdio transport for personal use, or an HTTP transport where every user authenticates with their own Paperless token and only sees their own documents
- **Docker-ready** — prebuilt image on GHCR, drop-in sidecar for your Paperless-ngx compose stack

Things you can ask once it's connected:

> "Find all invoices from my ISP in 2025 and tag them as telecom"
>
> "Upload this PDF, set the correspondent to my landlord, and file it as a contract"
>
> "Which documents in my inbox are missing a correspondent or document type?"
>
> "Find the document about the espresso machine warranty" _(semantic search — no keyword match needed)_

## Quick start

The package is published as [`@orellbuehler/paperless-mcp`](https://www.npmjs.com/package/@orellbuehler/paperless-mcp) and runs directly with `npx` — no clone or build needed.

1. Get your API token from Paperless-ngx (Settings > Administration, or `POST /api/token/`)
2. Register the server with your MCP client. With Claude Code:

```bash
claude mcp add paperless \
  --env PAPERLESS_URL=https://your-paperless-instance.example.com \
  --env PAPERLESS_TOKEN=your-api-token \
  -- npx -y @orellbuehler/paperless-mcp
```

Or as JSON config (Claude Desktop and most other MCP clients use the same shape):

```json
{
  "mcpServers": {
    "paperless": {
      "command": "npx",
      "args": ["-y", "@orellbuehler/paperless-mcp"],
      "env": {
        "PAPERLESS_URL": "https://your-paperless-instance.example.com",
        "PAPERLESS_TOKEN": "your-api-token"
      }
    }
  }
}
```

3. Restart your MCP client. The tools are available immediately.

Semantic search is off by default. To enable it, add `"EMBEDDINGS_ENABLED": "true"` (and `"OPENAI_API_KEY"` if using the OpenAI embedding provider), then run `sync_embeddings` once to index your documents. The `better-sqlite3` and `sqlite-vec` native modules are installed automatically as optional dependencies (this requires a build toolchain on your platform); the core document tools work without them.

## Available Tools

### Core API Tools

| Category            | Tools                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search              | `search_documents`, `search_autocomplete`                                                                                                                                        |
| Documents           | `list_documents`, `get_document`, `get_documents`, `download_document`, `update_document`, `delete_document`, `upload_document`                                                  |
| Document details    | `get_document_metadata`, `get_document_suggestions`, `get_document_notes`, `add_document_note`, `delete_document_note`, `get_document_history`                                   |
| Bulk operations     | `bulk_edit_documents`, `bulk_set_object_permissions`, `get_next_asn`, `get_selection_data`, `bulk_download_documents`                                                            |
| Storage path tools  | `test_storage_path`                                                                                                                                                              |
| Correspondents      | `list_correspondents`, `get_correspondent`, `create_correspondent`, `update_correspondent`, `delete_correspondent`                                                               |
| Document types      | `list_document_types`, `get_document_type`, `create_document_type`, `update_document_type`, `delete_document_type`                                                               |
| Tags                | `list_tags`, `get_tag`, `create_tag`, `update_tag`, `delete_tag`                                                                                                                 |
| Saved views         | `list_saved_views`, `get_saved_view`, `create_saved_view`, `update_saved_view`                                                                                                   |
| Storage paths       | `list_storage_paths`, `get_storage_path`, `create_storage_path`, `update_storage_path`                                                                                           |
| Custom fields       | `list_custom_fields`, `get_custom_field`, `create_custom_field`, `update_custom_field`                                                                                           |
| Users               | `list_users`, `get_user`, `create_user`, `update_user`                                                                                                                           |
| Groups              | `list_groups`, `get_group`, `create_group`, `update_group`                                                                                                                       |
| Paperless workflows | `list_workflows`, `get_workflow`, `create_workflow`, `update_workflow`                                                                                                           |
| Mail accounts       | `list_mail_accounts`, `get_mail_account`, `create_mail_account`, `update_mail_account`, `test_mail_account`, `process_mail_account`                                              |
| Mail rules          | `list_mail_rules`, `get_mail_rule`, `create_mail_rule`, `update_mail_rule`, `list_processed_mail`                                                                                |
| Sharing             | `list_share_links`, `get_share_link`, `create_share_link`, `get_document_share_links`                                                                                            |
| Email               | `email_document`, `email_documents`                                                                                                                                              |
| Trash               | `list_trash`, `restore_from_trash`, `empty_trash`                                                                                                                                |
| System              | `get_status`, `get_statistics`, `list_tasks`, `acknowledge_tasks`, `get_config`, `update_config`, `get_ui_settings`, `get_profile`, `get_remote_version`, `list_logs`, `get_log` |

> **Note:** `list_documents` and `search_documents` return document metadata only (no OCR text) to keep responses small. Use `get_document` (single) or `get_documents` (batch) to retrieve full content.
>
> Saved views, users/groups, and workflows support read + create + update only — no delete tools (use the Paperless web UI to delete). User management covers accounts and group membership; it does not set per-document permissions. Notes support add and delete only (no edit), so there is no note-editing tool.
>
> The `update_*` tools for tags, correspondents, document types, storage paths, saved views, and custom fields accept `owner` and `set_permissions` (`{ view, change }` → `{ users, groups }`) to share objects. `bulk_set_object_permissions` sets owner/permissions on many tags, correspondents, document types, or storage paths in one call (saved views and custom fields are not supported by the bulk endpoint — share those individually).

### Extended Tools

| Category        | Tools                                                                  | Description                                              |
| --------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Semantic search | `semantic_search`, `sync_embeddings`, `embedding_status`               | Vector similarity search using local sqlite-vec database |
| Content         | `get_document_content`                                                 | Extract OCR'd text content from documents                |
| Workflows       | `auto_classify_document`, `process_inbox`, `bulk_tag_by_content`       | AI-assisted classification and bulk operations           |
| Helpers         | `get_documents_by_correspondent`, `monthly_summary`, `upload_from_url` | Convenience tools for common workflows                   |

### Paperless-ngx 3.0+ Tools

These call endpoints that only exist on Paperless-ngx 3.0 and later. On older servers they return a 404 error; everything else in the table above works on 2.x too.

| Category          | Tools                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Document versions | `upload_document_version`, `set_document_version_label`, `delete_document_version`, `get_document_root`       |
| Document editing  | `rotate_documents`, `merge_documents`, `edit_pdf_document`, `remove_document_password`, `reprocess_documents` |
| AI                | `get_document_ai_suggestions`                                                                                 |
| Share bundles     | `list_share_link_bundles`, `get_share_link_bundle`, `create_share_link_bundle`, `rebuild_share_link_bundle`   |
| Task management   | `run_task`, `get_task_summary`, `get_task_status_counts`, `get_active_tasks`                                  |

> On Paperless-ngx 2.x, use `bulk_edit_documents` with `method: "rotate" | "merge" | "split"` instead of the dedicated document-editing tools. Both paths still work on 3.x.

## API Versioning

Paperless-ngx negotiates its REST API version through the `Accept` header. This server pins **API v9** by default, which is what every tool above is written against and what both 2.x and 3.x servers accept.

This matters because Paperless-ngx 3.0 made v10 the server-side default. Sending no version header at all means a 3.x server answers with v10 shapes, which differ in ways that break clients written for v9:

- `/api/tasks/` becomes paginated, and `task_name`/`type` are renamed to `task_type`/`trigger_source`
- Saved views drop `show_on_dashboard` and `show_in_sidebar` (they move to UI settings), so `create_saved_view` would silently create views that never appear in the sidebar

Set `PAPERLESS_API_VERSION=10` to opt into v10 once you are ready for those changes, or `PAPERLESS_API_VERSION=none` to send no header and let the server pick. Note that `create_saved_view` and `list_tasks` still assume v9 semantics.

## Environment Variables

| Variable                | Required        | Description                                                                                                                                                       |
| ----------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAPERLESS_URL`         | Yes             | Base URL of your Paperless-ngx instance                                                                                                                           |
| `PAPERLESS_TOKEN`       | Yes             | API token. In `stdio` mode this is the user's token; in `http` mode it is the admin/indexer token (builds the shared embedding index and gates `sync_embeddings`) |
| `PAPERLESS_API_VERSION` | No              | Paperless REST API version to request (default: `9`). Set to `10` for Paperless-ngx 3.0+ v10 semantics, or `none` to send no version header                       |
| `MCP_TRANSPORT`         | No              | `stdio` (default) or `http`                                                                                                                                       |
| `PORT`                  | No              | Port for the HTTP server (default: `3001`, http mode only)                                                                                                        |
| `EMBEDDINGS_ENABLED`    | No              | Set to `true` to enable semantic search tools (default: off)                                                                                                      |
| `MCP_ALLOWED_ORIGINS`   | No              | Comma-separated `Origin` allowlist for browser clients (http mode). Empty (default) blocks all cross-origin browser requests; use `*` to allow any                |
| `MCP_ALLOWED_HOSTS`     | No              | Comma-separated `Host` allowlist for DNS-rebinding protection (http mode). Empty (default) disables host validation                                               |
| `EMBEDDING_PROVIDER`    | No              | `openai` or `ollama` (default: `openai`)                                                                                                                          |
| `OPENAI_API_KEY`        | If using OpenAI | Required for OpenAI embeddings                                                                                                                                    |
| `OLLAMA_URL`            | If using Ollama | Ollama server URL (default: `http://localhost:11434`)                                                                                                             |
| `EMBEDDING_MODEL`       | No              | Model name (defaults per provider)                                                                                                                                |
| `EMBEDDING_DIMENSIONS`  | No              | Vector dimensions (defaults per provider)                                                                                                                         |
| `PAPERLESS_MCP_DATA`    | No              | Directory for the vector DB (default: `~/.paperless-mcp`)                                                                                                         |

## Transports

The server supports two transports, selected by `MCP_TRANSPORT`.

### stdio (default)

Single-user. The MCP client launches the server as a subprocess and it uses
`PAPERLESS_TOKEN` for all requests. This is the configuration shown above.

### HTTP (multi-user)

Run the server as a shared HTTP service (e.g. a sidecar next to your Paperless-ngx
deployment) so other users on your network can connect:

```bash
MCP_TRANSPORT=http PORT=3001 \
  PAPERLESS_URL=https://paperless.example.com \
  PAPERLESS_TOKEN=<admin-token> \
  node dist/index.js
```

Clients connect to `http://<host>:3001/mcp` and authenticate with **their own**
Paperless API token via an `Authorization: Bearer <token>` header (or
`X-Paperless-Token`). Every Paperless call is made with that token, so each user
only sees the documents their account permits.

`PAPERLESS_TOKEN` is the admin/indexer token: it builds the shared semantic-search
index, and the `sync_embeddings` tool is only available to a session using the
admin token. `semantic_search` results are filtered through the requesting user's
token, so users never see documents they cannot access.

Non-browser MCP clients (which don't send an `Origin` header) work out of the box.
Browser-based clients are blocked unless you list their origin in
`MCP_ALLOWED_ORIGINS`. If the server is reachable on a public hostname, set
`MCP_ALLOWED_HOSTS` to the expected host(s) for DNS-rebinding protection.

## Run as an HTTP sidecar (Docker)

A prebuilt image is published to the GitHub Container Registry on every release
and every push to `main`:

```
ghcr.io/orellbuehler/paperless-mcp:latest   # tracks main
ghcr.io/orellbuehler/paperless-mcp:1         # latest 1.x release
ghcr.io/orellbuehler/paperless-mcp:1.0.0     # exact version
```

Pull it directly:

```bash
docker pull ghcr.io/orellbuehler/paperless-mcp:latest
```

Add the server as a service next to your existing Paperless-ngx compose stack:

```yaml
paperless-mcp:
  image: ghcr.io/orellbuehler/paperless-mcp:latest
  restart: unless-stopped
  depends_on:
    - webserver
  ports:
    - 3001:3001
  volumes:
    - /mnt/ssd/paperless_ngx/mcp:/data
  environment:
    MCP_TRANSPORT: http
    PORT: 3001
    PAPERLESS_URL: http://webserver:8000
    PAPERLESS_TOKEN: <admin-token>
    PAPERLESS_MCP_DATA: /data
    EMBEDDINGS_ENABLED: "true"
    EMBEDDING_PROVIDER: openai
    OPENAI_API_KEY: <key>
```

The image already defaults to `MCP_TRANSPORT=http`, `PORT=3001`, and
`PAPERLESS_MCP_DATA=/data`, so the only variables you must set are
`PAPERLESS_URL` and `PAPERLESS_TOKEN` (plus `OPENAI_API_KEY` when semantic
search is enabled). Mount a volume at `/data` to persist the embedding index
across restarts.

LAN clients connect to `http://<host>:3001/mcp` with their own Paperless API
token. Run `sync_embeddings` once with the admin token to build the shared
semantic index.

To build the image yourself instead of pulling it, a `Dockerfile` is included:

```bash
docker build -t paperless-mcp .
```

## Development

For local development, clone the repo and build the `dist/` output:

```bash
npm install
npm run build
npm test
```

To run your local build instead of the npm package, use `"command": "node"` with
`"args": ["/path/to/paperless-mcp/dist/index.js"]` in your MCP config.

Optionally enable the git pre-commit hooks, which run the same `format:check` /
`lint` / `typecheck` / `test` gates as CI before each commit. They use
[prek](https://github.com/j178/prek) (a fast, dependency-free pre-commit runner);
install it, then activate the hooks once per clone:

```bash
prek install
```

### Updating a source install

The server runs from the compiled `dist/` output, so updating is just rebuild + restart — there's no need to re-run `claude mcp add` (the launch command and path don't change):

```bash
git pull          # if you track a remote
npm install       # only if dependencies changed
npm run build     # recompile src/ -> dist/
```

Then restart your MCP client so it re-spawns the server with the new build. Verify with `claude mcp list` (should show `paperless ✓ connected`) or run `/mcp` inside a session.

To change connection settings (URL, token, embedding provider), edit the `env` block in your config, or re-register the server:

```bash
claude mcp remove paperless
claude mcp add paperless --scope user \
  --env PAPERLESS_URL=http://localhost:8000 \
  --env PAPERLESS_TOKEN=your-api-token \
  -- node /path/to/paperless-mcp/dist/index.js
```

### Regenerating the API spec

`paperless-openapi.yaml` is the Paperless-ngx OpenAPI schema used as a reference when building tools. Pull a fresh copy straight from a running instance (no Docker needed):

```bash
PAPERLESS_URL=https://your-paperless-instance.example.com \
PAPERLESS_TOKEN=your-api-token \
npm run spec:update
```

This fetches `GET /api/schema/` and overwrites `paperless-openapi.yaml`. Run it whenever you upgrade Paperless-ngx.

## License

[MIT](LICENSE)
