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
> "Give me just the page of my insurance policy that mentions the deductible, as a PDF"
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
| Storage paths       | `list_storage_paths`, `get_storage_path`, `create_storage_path`, `update_storage_path`, `delete_storage_path`                                                                    |
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
> `list_documents` supports inclusive and exclusive date ranges (`created`/`added` `__date__gt|gte|lt|lte`), multi-value filters (`correspondent__id__in`, `document_type__id__in`, `tags__id__in|all`), and `custom_field_query` (JSON expressions like `["Amount", "gt", 100]`) for filtering by custom field values. `yearly_document_check` compares a year against the previous one per correspondent + document type — useful for spotting missing recurring documents (e.g. when preparing a tax report).
>
> Saved views, users/groups, and workflows support read + create + update only — no delete tools (use the Paperless web UI to delete). User management covers accounts and group membership; it does not set per-document permissions. Notes support add and delete only (no edit), so there is no note-editing tool.
>
> The `update_*` tools for tags, correspondents, document types, storage paths, saved views, and custom fields accept `owner` and `set_permissions` (`{ view, change }` → `{ users, groups }`) to share objects. `bulk_set_object_permissions` sets owner/permissions on many tags, correspondents, document types, or storage paths in one call (saved views and custom fields are not supported by the bulk endpoint — share those individually).

### Extended Tools

| Category        | Tools                                                                                           | Description                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic search | `semantic_search`, `sync_embeddings`, `embedding_status`                                        | Vector similarity search using local sqlite-vec database                                                                                       |
| Content         | `get_document_content`                                                                          | Extract OCR'd text content from documents                                                                                                      |
| Workflows       | `auto_classify_document`, `process_inbox`, `bulk_tag_by_content`                                | AI-assisted classification and bulk operations                                                                                                 |
| Helpers         | `get_documents_by_correspondent`, `monthly_summary`, `yearly_document_check`, `upload_from_url` | Convenience tools for common workflows                                                                                                         |
| PDF pages       | `extract_document_pages`, `find_document_pages`                                                 | Extract pages into a new PDF file or find the pages containing a text snippet — processed locally, without modifying the document in Paperless |

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

| Variable                       | Required        | Description                                                                                                                                                       |
| ------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAPERLESS_URL`                | Yes             | Base URL of your Paperless-ngx instance                                                                                                                           |
| `PAPERLESS_TOKEN`              | Yes             | API token. In `stdio` mode this is the user's token; in `http` mode it is the admin/indexer token (builds the shared embedding index and gates `sync_embeddings`) |
| `PAPERLESS_API_VERSION`        | No              | Paperless REST API version to request (default: `9`). Set to `10` for Paperless-ngx 3.0+ v10 semantics, or `none` to send no version header                       |
| `MCP_TRANSPORT`                | No              | `stdio` (default) or `http`                                                                                                                                       |
| `PORT`                         | No              | Port for the HTTP server (default: `3001`, http mode only)                                                                                                        |
| `EMBEDDINGS_ENABLED`           | No              | Set to `true` to enable semantic search tools (default: off)                                                                                                      |
| `MCP_ALLOWED_ORIGINS`          | No              | Comma-separated `Origin` allowlist for browser clients (http mode). Empty (default) blocks all cross-origin browser requests; use `*` to allow any                |
| `MCP_ALLOWED_HOSTS`            | No              | Comma-separated `Host` allowlist for DNS-rebinding protection (http mode). Empty (default) disables host validation                                               |
| `MCP_OAUTH_ISSUER`             | No              | OIDC issuer URL of your identity provider. Setting it enables [OAuth mode](#oauth-optional) (http mode only)                                                      |
| `MCP_OAUTH_CLIENT_ID`          | With OAuth      | Client ID of the OIDC client Paperless uses                                                                                                                       |
| `MCP_OAUTH_CLIENT_SECRET`      | No              | Client secret of that client (omit for public clients)                                                                                                            |
| `MCP_OAUTH_PAPERLESS_PROVIDER` | With OAuth      | `provider_id` of the OIDC app in `PAPERLESS_SOCIALACCOUNT_PROVIDERS`                                                                                              |
| `MCP_PUBLIC_URL`               | With OAuth      | Externally reachable origin of this server, e.g. `https://mcp.example.com`                                                                                        |
| `MCP_OAUTH_SCOPES`             | No              | Scopes requested from the identity provider (default: `openid email profile`)                                                                                     |
| `MCP_OAUTH_TOKEN_AUTH_METHOD`  | No              | `client_secret_post` or `client_secret_basic` for the IdP token request (default: picked from discovery, like Paperless)                                          |
| `MCP_OAUTH_ACCESS_TOKEN_TTL`   | No              | Lifetime of issued access tokens in seconds (default: `3600`)                                                                                                     |
| `MCP_OAUTH_REFRESH_TOKEN_TTL`  | No              | Maximum lifetime of a sign-in in seconds, counted from authorization; refreshing does not extend it (default: `2592000`, 30 days)                                 |
| `MCP_OAUTH_STATE_KEY`          | No              | Secret (at least 16 characters) that encrypts OAuth state on disk so registrations and sign-ins survive restarts. Unset: in memory only                           |
| `EMBEDDING_PROVIDER`           | No              | `openai` or `ollama` (default: `openai`)                                                                                                                          |
| `OPENAI_API_KEY`               | If using OpenAI | Required for OpenAI embeddings                                                                                                                                    |
| `OLLAMA_URL`                   | If using Ollama | Ollama server URL (default: `http://localhost:11434`)                                                                                                             |
| `EMBEDDING_MODEL`              | No              | Model name (defaults per provider)                                                                                                                                |
| `EMBEDDING_DIMENSIONS`         | No              | Vector dimensions (defaults per provider)                                                                                                                         |
| `PAPERLESS_MCP_DATA`           | No              | Directory for the vector DB and OAuth state (default: `~/.paperless-mcp`)                                                                                         |

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
only sees the documents their account permits. The token must be sent on every
request; a session only accepts the token it was initialized with.

`PAPERLESS_TOKEN` is the admin/indexer token: it builds the shared semantic-search
index, and the `sync_embeddings` tool is only available to a session using the
admin token. `semantic_search` results are filtered through the requesting user's
token, so users never see documents they cannot access.

Non-browser MCP clients (which don't send an `Origin` header) work out of the box.
Browser-based clients are blocked unless you list their origin in
`MCP_ALLOWED_ORIGINS`. If the server is reachable on a public hostname, set
`MCP_ALLOWED_HOSTS` to the expected host(s) for DNS-rebinding protection.

#### OAuth (optional)

MCP clients that only support OAuth sign-in (and users who'd rather not copy API
tokens around) can sign in through the same OpenID Connect provider Paperless
already uses for SSO. OAuth is **off** unless `MCP_OAUTH_ISSUER` is set, and it
only applies to the HTTP transport.

When enabled, paperless-mcp acts as the OAuth 2.1 authorization server for MCP
clients (per the MCP authorization spec):

1. It serves `/.well-known/oauth-protected-resource[/mcp]` and
   `/.well-known/oauth-authorization-server`, plus `/register` (dynamic client
   registration), `/authorize` and `/token`. PKCE (`S256`) is required. A request
   to `/mcp` without a valid token gets `401` with
   `WWW-Authenticate: Bearer resource_metadata="…"`.
2. `/authorize` shows a consent page naming the client and where access will be
   handed to. Invalid requests get an error page, never a redirect. After
   **Continue** (a form POST tied to a per-sign-in cookie), the user is redirected to your identity
   provider using Paperless's OIDC client.
3. On `/oauth/callback` the server exchanges the code for an ID token and passes
   it to Paperless's headless login endpoint
   (`/api/auth/headless/app/v1/auth/provider/token`). Paperless verifies the
   token and returns that user's normal API token.
4. The MCP client receives an opaque access token (plus a rotating refresh
   token) that maps to that Paperless token, so every tool call runs as the
   signed-in user.

```bash
MCP_TRANSPORT=http \
  PAPERLESS_URL=https://paperless.example.com \
  PAPERLESS_TOKEN=<admin-token> \
  MCP_PUBLIC_URL=https://mcp.example.com \
  MCP_OAUTH_ISSUER=https://auth.example.com/application/o/paperless/ \
  MCP_OAUTH_CLIENT_ID=<paperless-oidc-client-id> \
  MCP_OAUTH_CLIENT_SECRET=<paperless-oidc-client-secret> \
  MCP_OAUTH_PAPERLESS_PROVIDER=authentik \
  node dist/index.js
```

Setup:

- **Identity provider:** reuse the OIDC client Paperless already has and add
  `{MCP_PUBLIC_URL}/oauth/callback` as an extra redirect URI. Paperless checks
  that the ID token's audience is its own client, so a separate client won't work.
- **Paperless:** OIDC social login must be configured in
  `PAPERLESS_SOCIALACCOUNT_PROVIDERS`. `MCP_OAUTH_PAPERLESS_PROVIDER` is that
  app's `provider_id`, and `MCP_OAUTH_ISSUER` must be the same issuer as its
  `server_url`. A user must have signed in to Paperless via SSO once (so the
  account is linked), unless `PAPERLESS_SOCIALACCOUNT_ALLOW_SIGNUPS` is on.
- **MFA:** if a user has two-factor auth in Paperless, the sign-in stops at the
  MFA step and fails. Set `PAPERLESS_SOCIAL_ACCOUNT_MFA_TRUSTED_AMR` so Paperless
  trusts the provider's MFA.
- **Group sync:** with `PAPERLESS_SOCIAL_ACCOUNT_SYNC_GROUPS` on, every sign-in
  re-syncs the user's groups from the ID token. Make `MCP_OAUTH_SCOPES` match
  the scopes Paperless requests (e.g. `openid email profile groups`) and make
  sure the groups claim is in the ID token. Otherwise the user's groups can be
  removed.

Notes:

- `Authorization: Bearer` must carry an OAuth-issued token in this mode. Raw
  Paperless API tokens still work through `X-Paperless-Token` (e.g. for service
  accounts). This way an expired OAuth token gets a proper `401` challenge
  instead of being passed to Paperless.
- Without `MCP_OAUTH_STATE_KEY`, client registrations and tokens live in memory
  (the server says so at startup): after a restart, clients have to register
  and authorize again. Set it to a long random secret (e.g.
  `openssl rand -base64 32`) to keep them in
  `$PAPERLESS_MCP_DATA/oauth-state.json` (default `~/.paperless-mcp`). The file
  is encrypted with AES-256-GCM using a key derived from the secret with scrypt,
  and written atomically with mode `0600`. Access and refresh tokens are stored
  only as SHA-256 hashes; users' Paperless tokens appear only inside the
  encrypted payload. Sign-ins in progress and authorization codes are not saved.
  Writes are batched (at most one per second) and flushed on `SIGTERM`/`SIGINT`;
  revocations and refresh-token rotation are written immediately (if that write
  fails, a refresh is rolled back and answered with `503`, and a revocation still
  applies in memory while the save is retried). If the file
  can't be decrypted (wrong key or corrupt), the server logs a warning, moves it
  to `oauth-state.json.bak-<timestamp>` and starts empty, so changing the key
  signs everyone out. To recover from a mistyped key, rename the backup back
  and restart with the right key.
- A sign-in lasts at most `MCP_OAUTH_REFRESH_TOKEN_TTL` (30 days by default),
  counted from when the user authorized. Refreshing rotates tokens but doesn't
  extend that limit; after it the user signs in again.
- `/register` and `/authorize` need no authentication, so their in-memory state
  is capped: 1000 registered clients and 10000 sign-ins in progress. Request
  bodies are limited to 8 KB; a client may register at most 10 redirect URIs
  (2000 characters each) and a `client_name` of up to 200 characters. When the
  client store is full, new registrations get `503`; clients that still have
  active tokens or an approved sign-in are never evicted. When the sign-in store
  is full, the oldest sign-ins are evicted (whether or not they were approved). Unapproved sign-ins expire after 3 minutes, and approved ones after 10
  (while the user is at the identity provider). Each grant keeps a single
  access token and a single refresh token. If the server is reachable from the
  internet, rate-limit `/register`, `/authorize` and `/oauth/consent` per client IP at your
  reverse proxy (e.g. 10–30 requests per minute).
- If the same authorization code is used twice, the tokens already issued from
  it are revoked.
- If Paperless rejects a user's token (e.g. they regenerated it), all grants for
  that token are revoked and the client is asked to authorize again.
- `MCP_PUBLIC_URL` must be the externally reachable origin of this server
  (scheme + host, no path). The server refuses to start if it has a path, and
  warns if it isn't `https` (except for `localhost`/`127.0.0.1`). Origin and host
  checks apply to the OAuth endpoints as well. The one exception: the consent
  form may post from `MCP_PUBLIC_URL`'s own origin.

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
(and, with `MCP_OAUTH_STATE_KEY`, OAuth sign-ins) across restarts.

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
