import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config, clientFor } from "./config.js";
import { createServer } from "./server.js";
import type { Credential, OAuth } from "./oauth.js";
import type { PaperlessClient } from "./paperless/client.js";

export interface HttpLimits {
  maxBodyBytes: number;
  maxSessions: number;
  sessionIdleMs: number;
}

export const DEFAULT_HTTP_LIMITS: HttpLimits = {
  maxBodyBytes: 4 * 1024 * 1024,
  maxSessions: 1000,
  sessionIdleMs: 24 * 60 * 60 * 1000,
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Headers = Record<string, string | string[] | undefined>;

export function extractToken(headers: Headers): string | null {
  const auth = headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const t = auth.slice("Bearer ".length).trim();
    if (t) return t;
  }
  const x = headers["x-paperless-token"];
  if (typeof x === "string" && x.trim()) return x.trim();
  return null;
}

export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser clients don't send Origin
  return config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin);
}

export function hostAllowed(host: string | undefined): boolean {
  if (config.allowedHosts.length === 0) return true; // host validation disabled
  if (!host) return false;
  return config.allowedHosts.includes(host) || config.allowedHosts.includes(host.split(":")[0]);
}

export function sessionTokenMatches(expected: string, actual: string | null): boolean {
  if (!actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function plainCredential(headers: Headers): Credential | null {
  const token = extractToken(headers);
  return token ? { key: token, token, oauth: false } : null;
}

function setCors(res: ServerResponse, origin: string | undefined, oauth: boolean) {
  if (config.allowedOrigins.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Paperless-Token, mcp-session-id",
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    oauth ? "mcp-session-id, WWW-Authenticate" : "mcp-session-id",
  );
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const tooLarge = () => new HttpError(413, `Request body exceeds ${maxBytes} bytes`);
  if (Number(req.headers["content-length"]) > maxBytes) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > maxBytes) throw tooLarge();
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

async function verifyToken(client: PaperlessClient) {
  try {
    await client.fetch("/api/profile/");
  } catch (e) {
    if (e instanceof Error && /^(401|403) /.test(e.message))
      throw new HttpError(401, "Paperless rejected the token");
    console.error(
      "paperless-mcp: could not verify a token with Paperless:",
      e instanceof Error ? e.message : e,
    );
    throw new HttpError(502, "Could not reach Paperless to verify the token");
  }
}

export function createHttpHandler(
  oauth: OAuth | null = null,
  limits: HttpLimits = DEFAULT_HTTP_LIMITS,
) {
  type Session = { transport: StreamableHTTPServerTransport; key: string; seen: number };
  const transports = new Map<string, Session>();

  const drop = (sid: string, session: Session) => {
    transports.delete(sid);
    session.transport.close().catch(() => {});
  };

  const makeRoom = () => {
    const now = Date.now();
    for (const [sid, session] of transports) {
      if (now - session.seen > limits.sessionIdleMs || transports.size >= limits.maxSessions)
        drop(sid, session);
      else break;
    }
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const origin = req.headers.origin;
    setCors(res, origin, Boolean(oauth));
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (!hostAllowed(req.headers.host)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Host not allowed" }));
      return;
    }
    if (!originAllowed(origin) && !oauth?.consentOrigin(req)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Origin not allowed" }));
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${config.port}`);

    try {
      if (oauth && (await oauth.handle(req, res, url))) return;

      if (url.pathname !== "/mcp") {
        res.writeHead(404).end();
        return;
      }

      const credential = oauth ? oauth.resolve(req.headers) : plainCredential(req.headers);
      if (oauth && !credential) {
        oauth.challenge(res, req.headers);
        return;
      }

      const rawSessionId = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

      if (sessionId) {
        const existing = transports.get(sessionId);
        if (!existing || !sessionTokenMatches(existing.key, credential?.key ?? null)) {
          // Unknown/expired session — let the client re-initialize.
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unknown or expired session" }));
          return;
        }
        existing.seen = Date.now();
        transports.delete(sessionId);
        transports.set(sessionId, existing);
        const body = await readBody(req, limits.maxBodyBytes);
        await existing.transport.handleRequest(req, res, body);
        return;
      }

      // No session id => initialize request: require a token.
      if (!credential) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Missing Paperless token (Authorization: Bearer <token>)" }),
        );
        return;
      }

      const client = clientFor(credential.token);
      if (oauth && credential.oauth) {
        client.onUnauthorized = () => oauth.revokePaperlessToken(credential.token);
      } else {
        await verifyToken(client);
      }
      const body = await readBody(req, limits.maxBodyBytes);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          makeRoom();
          transports.set(sid, { transport, key: credential.key, seen: Date.now() });
        },
        onsessionclosed: (sid: string) => {
          transports.delete(sid);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
      };

      const server = await createServer(client);
      await server.connect(transport);

      await transport.handleRequest(req, res, body);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error("paperless-mcp: request failed:", e);
      if (!res.headersSent) {
        const status = e instanceof HttpError ? e.status : 500;
        res.writeHead(status, {
          "Content-Type": "application/json",
          ...(status === 413 ? { Connection: "close" } : {}),
        });
        res.end(
          JSON.stringify({ error: e instanceof HttpError ? e.message : "Internal server error" }),
        );
      }
    }
  };
}

function flushOnShutdown(flush: () => void) {
  process.on("exit", flush);
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      flush();
      process.kill(process.pid, signal);
    });
}

export async function startHttpServer(): Promise<void> {
  let oauth: OAuth | null = null;
  if (config.oauthEnabled) {
    const { createOAuth, oauthSettingsFromEnv, DEFAULT_LIMITS } = await import("./oauth.js");
    const { stateStoreFromEnv } = await import("./oauth-state.js");
    try {
      const settings = oauthSettingsFromEnv();
      const store = stateStoreFromEnv();
      oauth = createOAuth(settings, config.baseUrl, DEFAULT_LIMITS, store);
      if (store) flushOnShutdown(oauth.flush);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  }

  if (config.allowedHosts.length === 0) {
    console.error(
      "Warning: MCP_ALLOWED_HOSTS is not set, so any Host header is accepted. Set it to the hostname(s) clients use to enable DNS-rebinding protection.",
    );
  }

  const httpServer = createHttpServer(createHttpHandler(oauth));
  httpServer.listen(config.port, () => {
    console.error(
      `paperless-mcp HTTP server listening on :${config.port}/mcp${oauth ? " (OAuth enabled)" : ""}`,
    );
  });
}
