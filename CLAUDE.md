# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP server that exposes the Paperless-ngx REST API as tools for AI agents, plus optional local-vector semantic search. Published to npm as `@orellbuehler/paperless-mcp` and runs via `npx`; the compiled `dist/index.js` is the `bin` entry. See `README.md` for the full tool catalog and env-var reference.

## Commands

```bash
npm run build         # tsc -> dist/
npm test              # vitest run (all tests)
npm run test:watch    # vitest watch
npm run lint          # eslint src
npm run typecheck     # tsc --noEmit
npm run format        # prettier --write .
npm run format:check  # prettier --check . (what CI runs)
npm run spec:update   # refetch paperless-openapi.yaml from a live instance (needs PAPERLESS_URL + PAPERLESS_TOKEN)
```

Run a single test file or pattern:

```bash
npx vitest run src/__tests__/core-tools.test.ts
npx vitest run -t "update_correspondent PATCHes"
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint`, `typecheck`, and `test` in that order — all must pass. Run them locally before committing.

## Architecture

Request flow: `index.ts` picks a transport based on `MCP_TRANSPORT`, then `server.ts:createServer(client)` registers all tool groups against a `PaperlessClient`. Every tool ultimately calls `client.fetch(...)` against the Paperless REST API.

- **`src/index.ts`** — entry point. `http` transport → `startHttpServer()`; otherwise stdio with `adminClient`.
- **`src/config.ts`** — reads env at import time and **exits the process** if `PAPERLESS_URL`/`PAPERLESS_TOKEN` are missing. Exports `adminClient` and `clientFor(token)` (an LRU cache of per-token clients, used in http mode).
- **`src/paperless/client.ts`** — thin `fetch` wrapper. Auth is `Authorization: Token <token>`. Provides `fetchAllPages`, `download`, `upload`, `getDocumentContent`. Throws on non-2xx with the response body in the message.
- **`src/paperless/format.ts`** — shared helpers used by every tool: `buildQS` (array values are comma-joined), `ok`/`err` (MCP content envelopes), and `summarizeDocs` (strips OCR `content` from list/search responses to keep payloads small).
- **`src/tools/*.ts`** — each exports a `register*Tools(server, client)` function. `server.ts` calls them all. Tool groups: `core` (documents, search, organization CRUD, bulk ops), `workflow` (AI-assisted classify/inbox), `helpers` (content extraction, convenience), `users` (users/groups), `automation` (Paperless workflows).
- **Semantic search is optional and lazily loaded.** `server.ts` dynamically imports `tools/search.ts` only when `config.embeddingsEnabled`. That subsystem (`embeddings.ts` provider abstraction over OpenAI/Ollama, `vectordb.ts` sqlite-vec store at `~/.paperless-mcp/vectors.db`) depends on `better-sqlite3`/`sqlite-vec`, which are **optionalDependencies** — never import them from always-loaded modules.

### Two transports, one server

- **stdio** (default): single-user. All requests use `PAPERLESS_TOKEN`.
- **http** (`src/http.ts`): multi-user. Each request carries the user's own token (`Authorization: Bearer` or `X-Paperless-Token`); a fresh `createServer(clientFor(token))` is built per session so every Paperless call runs as that user. `PAPERLESS_TOKEN` is the admin/indexer token. Security is enforced by `MCP_ALLOWED_ORIGINS` (browser origin allowlist) and `MCP_ALLOWED_HOSTS` (DNS-rebinding protection) — see `originAllowed`/`hostAllowed`.

In http mode, **admin-gated tools check `client.token === config.adminToken`** (e.g. `sync_embeddings` only registers for the admin session). `semantic_search` over-fetches from the shared index and then filters hits through the requesting user's token so users never see documents they can't access — preserve this pattern when touching search.

## Conventions

- **ESM with Node16 module resolution: all relative imports must end in `.js`** (e.g. `import { ok } from "../paperless/format.js"`), even though the source is `.ts`.
- **Tool handler shape:** `server.tool(name, description, zodSchema, async (args) => { try { return ok(await client.fetch(...)); } catch (e) { return err(e); } })`. Match the surrounding try/catch-`ok`/`err` style exactly.
- **Don't add comments, docstrings, or type annotations** unless they already exist in the file you're editing (per global preference).
- **Scope is intentionally read + create + update.** Saved views, users/groups, workflows, and custom fields have no delete tools by design — don't add them. Update tools for organization objects accept `owner` and `set_permissions` (`{ view, change }` → `{ users, groups }`) for sharing.
- `paperless-openapi.yaml` is the reference schema for what endpoints/fields exist — consult it (or regenerate via `spec:update`) when adding tools rather than guessing field names.

## Tests

Tests live in `src/__tests__/*.test.ts` and mock at two layers. Because `config.ts` reads env at import time and exits if it's missing, tests **`vi.stubEnv("PAPERLESS_URL"/"PAPERLESS_TOKEN")` and then dynamically `await import(...)`** the modules under test — keep that ordering. Tool tests typically pass a fake `{ tool: (name, desc, schema, handler) => ... }` server to the `register*Tools` function to capture handlers, then stub global `fetch` (or override `client.fetch`/`client.download`) to assert the exact request path/method/body.
