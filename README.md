# paperless-mcp

MCP server for [Paperless-ngx](https://docs.paperless-ngx.com/) that exposes the REST API as tools for AI agents.

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
        "PAPERLESS_TOKEN": "your-api-token"
      }
    }
  }
}
```

4. Restart Claude Code. The tools will be available immediately.

## Available Tools

| Category | Tools |
|----------|-------|
| Search | `search_documents`, `search_autocomplete` |
| Documents | `list_documents`, `get_document`, `download_document`, `update_document`, `delete_document`, `upload_document` |
| Document details | `get_document_metadata`, `get_document_suggestions`, `get_document_notes`, `add_document_note`, `delete_document_note` |
| Bulk operations | `bulk_edit_documents`, `get_next_asn` |
| Correspondents | `list_correspondents`, `get_correspondent`, `create_correspondent`, `delete_correspondent` |
| Document types | `list_document_types`, `get_document_type`, `create_document_type`, `delete_document_type` |
| Tags | `list_tags`, `get_tag`, `create_tag`, `delete_tag` |
| Saved views | `list_saved_views`, `get_saved_view` |
| Storage paths | `list_storage_paths` |
| Custom fields | `list_custom_fields` |
| System | `get_status`, `get_statistics`, `list_tasks` |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PAPERLESS_URL` | Yes | Base URL of your Paperless-ngx instance |
| `PAPERLESS_TOKEN` | Yes | API authentication token |
