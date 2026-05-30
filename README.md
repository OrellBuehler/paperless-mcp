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
| `PAPERLESS_TOKEN` | Yes | API authentication token |
| `EMBEDDING_PROVIDER` | No | `openai` (default) or `ollama` |
| `EMBEDDING_MODEL` | No | Model name (default: `text-embedding-3-small` for OpenAI, `nomic-embed-text` for Ollama) |
| `EMBEDDING_DIMENSIONS` | No | Embedding dimensions (default: `1536`) |
| `OPENAI_API_KEY` | If using OpenAI | OpenAI API key for embeddings |
| `OLLAMA_URL` | If using Ollama | Ollama server URL (default: `http://localhost:11434`) |
| `PAPERLESS_MCP_DATA` | No | Path to store vector database (default: `~/.paperless-mcp/`) |
