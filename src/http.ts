import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config, clientFor } from "./config.js";
import { createServer } from "./server.js";

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

function setCors(res: ServerResponse, origin: string | undefined) {
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
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function startHttpServer(): void {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createHttpServer(async (req, res) => {
    const origin = req.headers.origin;
    setCors(res, origin);
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (!hostAllowed(req.headers.host)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Host not allowed" }));
      return;
    }
    if (!originAllowed(origin)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Origin not allowed" }));
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${config.port}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

    const rawSessionId = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

    try {
      if (sessionId) {
        const existing = transports.get(sessionId);
        if (!existing) {
          // Unknown/expired session — let the client re-initialize.
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unknown or expired session" }));
          return;
        }
        const body = await readBody(req);
        await existing.handleRequest(req, res, body);
        return;
      }

      // No session id => initialize request: require a token.
      const token = extractToken(req.headers);
      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Missing Paperless token (Authorization: Bearer <token>)" }),
        );
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports.set(sid, transport);
        },
        onsessionclosed: (sid: string) => {
          transports.delete(sid);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
      };

      const server = await createServer(clientFor(token));
      await server.connect(transport);

      const body = await readBody(req);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    }
  });

  httpServer.listen(config.port, () => {
    console.error(`paperless-mcp HTTP server listening on :${config.port}/mcp`);
  });
}
