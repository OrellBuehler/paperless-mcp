import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config, clientFor } from "./config.js";
import { createServer } from "./server.js";
import type { Credential, OAuth } from "./oauth.js";

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

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createHttpHandler(oauth: OAuth | null = null) {
  const transports = new Map<string, { transport: StreamableHTTPServerTransport; key: string }>();

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
        const body = await readBody(req);
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

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports.set(sid, { transport, key: credential.key });
        },
        onsessionclosed: (sid: string) => {
          transports.delete(sid);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
      };

      const client = clientFor(credential.token);
      if (oauth && credential.oauth) {
        client.onUnauthorized = () => oauth.revokePaperlessToken(credential.token);
      }
      const server = await createServer(client);
      await server.connect(transport);

      const body = await readBody(req);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
  };
}

export async function startHttpServer(): Promise<void> {
  let oauth: OAuth | null = null;
  if (config.oauthEnabled) {
    const { createOAuth, oauthSettingsFromEnv, DEFAULT_LIMITS } = await import("./oauth.js");
    const { stateStoreFromEnv } = await import("./oauth-state.js");
    try {
      oauth = createOAuth(
        oauthSettingsFromEnv(),
        config.baseUrl,
        DEFAULT_LIMITS,
        stateStoreFromEnv(),
      );
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
    const flush = oauth.flush;
    process.on("exit", flush);
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      process.once(signal, () => {
        flush();
        process.kill(process.pid, signal);
      });
  }

  const httpServer = createHttpServer(createHttpHandler(oauth));
  httpServer.listen(config.port, () => {
    console.error(
      `paperless-mcp HTTP server listening on :${config.port}/mcp${oauth ? " (OAuth enabled)" : ""}`,
    );
  });
}
