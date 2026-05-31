# paperless-mcp

MCP server for [Paperless-ngx](https://docs.paperless-ngx.com/) that exposes the REST API as tools for AI agents. Includes semantic search via local vector embeddings.

## Setup

```bash
npm install
npm run build
```

## Usage with Claude Code

1. Get your API token from Paperless-ngx (Settings > Administration, or `POST /api/token/`)

2. Add the server to your Claude Code settings:

```bash
claude mcp add paperless -- node /path/to/paperless-mcp/dist/index.js
```

3. Set the environment variables by editing `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "paperless": {
      "command": "node",
      "args": ["/path/to/paperless-mcp/dist/index.js"],
      "env": {
        "PAPERLESS_URL": "https://your-paperless-instance.example.com",
        "PAPERLESS_TOKEN": "your-api-token",
        "EMBEDDING_PROVIDER": "openai",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

4. Restart Claude Code. The tools will be available immediately.

5. Run `sync_embeddings` to index your documents for semantic search.

## Updating

The server runs from the compiled `dist/` output, so updating is just rebuild + restart — there's no need to re-run `claude mcp add` (the launch command and path don't change):

```bash
git pull          # if you track a remote
npm install       # only if dependencies changed
npm run build     # recompile src/ -> dist/
```

Then restart Claude Code (or your MCP client) so it re-spawns the server with the new build. Verify with `claude mcp list` (should show `paperless ✓ connected`) or run `/mcp` inside a session.

To change connection settings (URL, token, embedding provider), edit the `env` block in your config, or re-register the server:

```bash
claude mcp remove paperless
claude mcp add paperless --scope user \
  --env PAPERLESS_URL=http://localhost:8000 \
  --env PAPERLESS_TOKEN=your-api-token \
  -- node /path/to/paperless-mcp/dist/index.js
```

## Available Tools

### Core API Tools

| Category | Tools |
|----------|-------|
| Search | `search_documents`, `search_autocomplete` |
| Documents | `list_documents`, `get_document`, `get_documents`, `download_document`, `update_document`, `delete_document`, `upload_document` |
| Document details | `get_document_metadata`, `get_document_suggestions`, `get_document_notes`, `add_document_note`, `delete_document_note` |
| Bulk operations | `bulk_edit_documents`, `get_next_asn` |
| Correspondents | `list_correspondents`, `get_correspondent`, `create_correspondent`, `update_correspondent`, `delete_correspondent` |
| Document types | `list_document_types`, `get_document_type`, `create_document_type`, `update_document_type`, `delete_document_type` |
| Tags | `list_tags`, `get_tag`, `create_tag`, `update_tag`, `delete_tag` |
| Saved views | `list_saved_views`, `get_saved_view` |
| Storage paths | `list_storage_paths`, `get_storage_path`, `create_storage_path`, `update_storage_path` |
| Custom fields | `list_custom_fields`, `get_custom_field`, `create_custom_field`, `update_custom_field` |
| System | `get_status`, `get_statistics`, `list_tasks` |

> **Note:** `list_documents` and `search_documents` return document metadata only (no OCR text) to keep responses small. Use `get_document` (single) or `get_documents` (batch) to retrieve full content.

### Extended Tools

| Category | Tools | Description |
|----------|-------|-------------|
| Semantic search | `semantic_search`, `sync_embeddings`, `embedding_status` | Vector similarity search using local sqlite-vec database |
| Content | `get_document_content` | Extract OCR'd text content from documents |
| Workflows | `auto_classify_document`, `process_inbox`, `bulk_tag_by_content` | AI-assisted classification and bulk operations |
| Helpers | `get_documents_by_correspondent`, `monthly_summary`, `upload_from_url` | Convenience tools for common workflows |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PAPERLESS_URL` | Yes | Base URL of your Paperless-ngx instance |
| `PAPERLESS_TOKEN` | Yes | API token. In `stdio` mode this is the user's token; in `http` mode it is the admin/indexer token (builds the shared embedding index and gates `sync_embeddings`) |
| `MCP_TRANSPORT` | No | `stdio` (default) or `http` |
| `PORT` | No | Port for the HTTP server (default: `3001`, http mode only) |
| `EMBEDDINGS_ENABLED` | No | Set to `true` to enable semantic search tools (default: off) |
| `MCP_ALLOWED_ORIGINS` | No | Comma-separated `Origin` allowlist for browser clients (http mode). Empty (default) blocks all cross-origin browser requests; use `*` to allow any |
| `MCP_ALLOWED_HOSTS` | No | Comma-separated `Host` allowlist for DNS-rebinding protection (http mode). Empty (default) disables host validation |
| `EMBEDDING_PROVIDER` | No | `openai` or `ollama` (default: `openai`) |
| `OPENAI_API_KEY` | If using OpenAI | Required for OpenAI embeddings |
| `OLLAMA_URL` | If using Ollama | Ollama server URL (default: `http://localhost:11434`) |
| `EMBEDDING_MODEL` | No | Model name (defaults per provider) |
| `EMBEDDING_DIMENSIONS` | No | Vector dimensions (defaults per provider) |
| `PAPERLESS_MCP_DATA` | No | Directory for the vector DB (default: `~/.paperless-mcp`) |

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

## Run as an HTTP sidecar (Docker Compose)

A `Dockerfile` is included. Add the server as a service next to your existing
Paperless-ngx compose stack:

```yaml
  paperless-mcp:
    build: https://github.com/<you>/paperless-mcp.git
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

LAN clients connect to `http://<host>:3001/mcp` with their own Paperless API
token. Run `sync_embeddings` once with the admin token to build the shared
semantic index.
