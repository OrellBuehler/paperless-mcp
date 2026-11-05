import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { OAuthClientMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { checkResourceAllowed } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import type { StateStore } from "./oauth-state.js";

type Headers = Record<string, string | string[] | undefined>;

export interface OAuthSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  provider: string;
  publicUrl: string;
  scopes: string;
  tokenAuthMethod: string;
  accessTokenTtl: number;
  refreshTokenTtl: number;
}

export interface OAuthLimits {
  maxClients: number;
  maxPending: number;
  maxCodes: number;
  maxTokens: number;
}

export interface Credential {
  key: string;
  token: string;
  oauth: boolean;
}

interface Client {
  name: string;
  redirectUris: string[];
  secretHash?: string;
  created: number;
}

interface Pending {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scope?: string;
  nonce: string;
  verifier: string;
  binding: string;
  approved: boolean;
  expires: number;
}

interface Grant {
  id: string;
  clientId: string;
  paperlessToken: string;
  scope?: string;
  expires: number;
  accessKey?: string;
  refreshKey?: string;
}

interface SavedGrant extends Grant {
  accessExpires?: number;
}

interface SavedState {
  clients?: Record<string, Client>;
  grants?: SavedGrant[];
}

interface Code {
  grant: Grant;
  redirectUri: string;
  codeChallenge: string;
  used: boolean;
  expires: number;
}

interface Issued {
  grant: Grant;
  expires: number;
}

interface Discovery {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  token_endpoint_auth_methods_supported?: string[];
}

export const DEFAULT_LIMITS: OAuthLimits = {
  maxClients: 1000,
  maxPending: 10_000,
  maxCodes: 1000,
  maxTokens: 10_000,
};

const PENDING_TTL = 600_000;
const CONSENT_TTL = 180_000;
const CODE_TTL = 60_000;
const MAX_BODY = 8 * 1024;
const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 2000;
const MAX_NAME_LENGTH = 200;
const MAX_PARAM_LENGTH = 1000;
const WRITE_DELAY = 1000;
const RETRY_DELAY = 10_000;
const COOKIE_PREFIX = "paperless_mcp_oauth_";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function positiveInt(value: string, fallback: number): number {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parsePublicUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`MCP_PUBLIC_URL is not a valid URL: ${value}`);
  }
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error(
      `MCP_PUBLIC_URL must be an origin without a path (e.g. https://mcp.example.com), got ${value}`,
    );
  if (url.protocol !== "https:" && !LOCAL_HOSTS.includes(url.hostname))
    console.error(
      `Warning: MCP_PUBLIC_URL is not https (${url.origin}); OAuth tokens travel in clear text`,
    );
  return url.origin;
}

export function oauthSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): OAuthSettings {
  const get = (k: string) => (env[k] || "").trim();
  const missing = [
    "MCP_OAUTH_ISSUER",
    "MCP_OAUTH_CLIENT_ID",
    "MCP_OAUTH_PAPERLESS_PROVIDER",
    "MCP_PUBLIC_URL",
  ].filter((k) => !get(k));
  if (missing.length) throw new Error(`OAuth mode requires ${missing.join(", ")}`);
  return {
    issuer: get("MCP_OAUTH_ISSUER").replace(/\/+$/, ""),
    clientId: get("MCP_OAUTH_CLIENT_ID"),
    clientSecret: get("MCP_OAUTH_CLIENT_SECRET"),
    provider: get("MCP_OAUTH_PAPERLESS_PROVIDER"),
    publicUrl: parsePublicUrl(get("MCP_PUBLIC_URL")),
    scopes: get("MCP_OAUTH_SCOPES") || "openid email profile",
    tokenAuthMethod: get("MCP_OAUTH_TOKEN_AUTH_METHOD"),
    accessTokenTtl: positiveInt(get("MCP_OAUTH_ACCESS_TOKEN_TTL"), 3600),
    refreshTokenTtl: positiveInt(get("MCP_OAUTH_REFRESH_TOKEN_TTL"), 30 * 86400),
  };
}

function random(): string {
  return randomBytes(32).toString("base64url");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function formEncode(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice(2);
}

function formDecode(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, " "));
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return safeEqual(sha256(verifier), challenge);
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    const v = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function bearerToken(headers: Headers): string | null {
  const auth = headers["authorization"];
  if (typeof auth !== "string") return null;
  const m = /^bearer(?:\s+(.*))?$/i.exec(auth.trim());
  return m ? (m[1] || "").trim() : null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function optional(value: unknown, check: (v: unknown) => boolean): boolean {
  return value === undefined || value === null || check(value);
}

function validClient(value: unknown): value is Client {
  const c = value as Client | null;
  return (
    !!c &&
    typeof c === "object" &&
    isString(c.name) &&
    Array.isArray(c.redirectUris) &&
    c.redirectUris.every(isString) &&
    Number.isFinite(c.created) &&
    optional(c.secretHash, isString)
  );
}

function validGrant(value: unknown): value is SavedGrant {
  const g = value as SavedGrant | null;
  return (
    !!g &&
    typeof g === "object" &&
    isString(g.id) &&
    isString(g.clientId) &&
    isString(g.paperlessToken) &&
    isString(g.refreshKey) &&
    Number.isFinite(g.expires) &&
    optional(g.scope, isString) &&
    optional(g.accessKey, isString) &&
    optional(g.accessExpires, Number.isFinite)
  );
}

function sweep(map: Map<string, { expires: number }>) {
  const now = Date.now();
  for (const [k, v] of map) if (v.expires <= now) map.delete(k);
}

function hasRoom(map: Map<string, { expires: number }>, max: number): boolean {
  if (map.size < max) return true;
  sweep(map);
  return map.size < max;
}

async function readText(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error("Request body too large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readParams(req: IncomingMessage): Promise<URLSearchParams> {
  const body = await readText(req);
  if (String(req.headers["content-type"] || "").includes("application/json")) {
    const obj = body ? JSON.parse(body) : {};
    return new URLSearchParams(
      Object.entries(obj).filter(([, v]) => typeof v === "string") as [string, string][],
    );
  }
  return new URLSearchParams(body);
}

function json(res: ServerResponse, status: number, body: unknown, headers: Headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function text(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(message);
}

function redirect(res: ServerResponse, location: string, headers: Headers = {}, status = 302) {
  res.writeHead(status, { Location: location, "Cache-Control": "no-store", ...headers });
  res.end();
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function readCookie(req: IncomingMessage, name: string): string {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

function withParams(base: string, params: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}

function paperlessError(status: number): string {
  if (status === 403)
    return "Paperless refused the sign-in (account not linked and signups closed)";
  if (status === 401) return "Paperless requires an additional sign-in step (e.g. MFA)";
  if (status === 400) return "Paperless rejected the identity token";
  return `Paperless sign-in failed (${status})`;
}

export function createOAuth(
  settings: OAuthSettings,
  paperlessUrl: string,
  limits: OAuthLimits = DEFAULT_LIMITS,
  store: StateStore | null = null,
) {
  const resourceUrl = `${settings.publicUrl}/mcp`;
  const resourceMetadataUrl = `${settings.publicUrl}/.well-known/oauth-protected-resource/mcp`;
  const callbackUrl = `${settings.publicUrl}/oauth/callback`;
  const cookieAttrs = `Path=/oauth; HttpOnly; SameSite=Lax${settings.publicUrl.startsWith("https:") ? "; Secure" : ""}`;
  const clients = new Map<string, Client>();
  const pending = new Map<string, Pending>();
  const codes = new Map<string, Code>();
  const access = new Map<string, Issued>();
  const refresh = new Map<string, Issued>();
  let discovery: Promise<Discovery> | null = null;
  let dirty = false;
  let timer: NodeJS.Timeout | null = null;

  const cookieName = (key: string) => `${COOKIE_PREFIX}${sha256(key).slice(0, 16)}`;
  const clearCookie = (key: string) => ({
    "Set-Cookie": `${cookieName(key)}=; ${cookieAttrs}; Max-Age=0`,
  });

  function resourceAllowed(resource: string): boolean {
    try {
      return checkResourceAllowed({
        requestedResource: resource,
        configuredResource: settings.publicUrl,
      });
    } catch {
      return false;
    }
  }

  function discover(): Promise<Discovery> {
    if (!discovery) {
      const url = settings.issuer.includes("/.well-known/")
        ? settings.issuer
        : `${settings.issuer}/.well-known/openid-configuration`;
      discovery = fetch(url).then(async (r) => {
        if (!r.ok) throw new Error(`OIDC discovery failed (${r.status})`);
        return (await r.json()) as Discovery;
      });
      discovery.catch(() => {
        discovery = null;
      });
    }
    return discovery;
  }

  function snapshot(): SavedState {
    const now = Date.now();
    const grants: SavedGrant[] = [];
    for (const { grant, expires } of refresh.values()) {
      if (expires <= now) continue;
      const a = grant.accessKey ? access.get(grant.accessKey) : undefined;
      grants.push({ ...grant, accessExpires: a && a.expires > now ? a.expires : undefined });
    }
    return { clients: Object.fromEntries(clients), grants };
  }

  function restore(state: SavedState | null) {
    if (!state || typeof state !== "object") return;
    const now = Date.now();
    const grants = (Array.isArray(state.grants) ? state.grants : [])
      .filter((g) => validGrant(g) && g.expires > now)
      .sort((a, b) => b.expires - a.expires)
      .slice(0, limits.maxTokens);
    const saved =
      state.clients && typeof state.clients === "object" && !Array.isArray(state.clients)
        ? state.clients
        : {};
    for (const id of [...grants.map((g) => g.clientId), ...Object.keys(saved)]) {
      if (clients.size >= limits.maxClients) break;
      const c = Object.hasOwn(saved, id) ? saved[id] : undefined;
      if (!clients.has(id) && validClient(c))
        clients.set(id, {
          name: c.name,
          redirectUris: c.redirectUris,
          secretHash: c.secretHash ?? undefined,
          created: c.created,
        });
    }
    for (const g of grants) {
      if (!clients.has(g.clientId)) continue;
      const grant: Grant = {
        id: g.id,
        clientId: g.clientId,
        paperlessToken: g.paperlessToken,
        scope: g.scope ?? undefined,
        expires: g.expires,
        refreshKey: g.refreshKey,
      };
      refresh.set(g.refreshKey!, { grant, expires: g.expires });
      if (g.accessKey && g.accessExpires && g.accessExpires > now) {
        grant.accessKey = g.accessKey;
        access.set(g.accessKey, { grant, expires: g.accessExpires });
      }
    }
  }

  function schedule(delay: number) {
    if (timer) return;
    timer = setTimeout(flush, delay);
    timer.unref();
  }

  function flush(): boolean {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!store || !dirty) return true;
    dirty = false;
    try {
      store.write(snapshot());
      return true;
    } catch (e) {
      dirty = true;
      schedule(RETRY_DELAY);
      console.error(
        `paperless-mcp could not save OAuth state: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }

  function persist(now = false): boolean {
    if (!store) return true;
    dirty = true;
    if (now) return flush();
    schedule(WRITE_DELAY);
    return true;
  }

  restore(store ? (store.read() as SavedState | null) : null);

  function clientHasRoom(): boolean {
    if (clients.size < limits.maxClients) return true;
    for (const map of [pending, codes, access, refresh]) sweep(map);
    const active = new Set<string>();
    for (const p of pending.values()) if (p.approved) active.add(p.clientId);
    for (const map of [codes, access, refresh])
      for (const v of map.values()) active.add(v.grant.clientId);
    const cutoff = Date.now() - PENDING_TTL;
    for (const [id, c] of clients)
      if (!active.has(id) && c.created <= cutoff && clients.delete(id)) persist();
    return clients.size < limits.maxClients;
  }

  function issue(grant: Grant) {
    const now = Date.now();
    const accessExpires = Math.min(now + settings.accessTokenTtl * 1000, grant.expires);
    const accessToken = random();
    const refreshToken = random();
    if (grant.accessKey) access.delete(grant.accessKey);
    if (grant.refreshKey) refresh.delete(grant.refreshKey);
    grant.accessKey = sha256(accessToken);
    grant.refreshKey = sha256(refreshToken);
    access.set(grant.accessKey, { grant, expires: accessExpires });
    refresh.set(grant.refreshKey, { grant, expires: grant.expires });
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.max(1, Math.floor((accessExpires - now) / 1000)),
      refresh_token: refreshToken,
      ...(grant.scope ? { scope: grant.scope } : {}),
    };
  }

  function revoke(match: (grant: Grant) => boolean) {
    let revoked = false;
    for (const map of [access, refresh])
      for (const [k, v] of map) if (match(v.grant) && map.delete(k)) revoked = true;
    if (revoked) persist(true);
  }

  function revokePaperlessToken(token: string) {
    revoke((g) => g.paperlessToken === token);
  }

  function resolve(headers: Headers): Credential | null {
    const t = bearerToken(headers);
    if (t !== null) {
      if (!t) return null;
      const entry = access.get(sha256(t));
      if (!entry || entry.expires <= Date.now()) return null;
      return { key: `oauth:${entry.grant.id}`, token: entry.grant.paperlessToken, oauth: true };
    }
    const x = headers["x-paperless-token"];
    if (typeof x === "string" && x.trim())
      return { key: `raw:${x.trim()}`, token: x.trim(), oauth: false };
    return null;
  }

  function challenge(res: ServerResponse, headers: Headers) {
    const presented = bearerToken(headers) !== null;
    const params = [`resource_metadata="${resourceMetadataUrl}"`];
    if (presented) params.unshift(`error="invalid_token"`);
    json(
      res,
      401,
      {
        error: presented ? "invalid_token" : "unauthorized",
        error_description: presented
          ? "Access token is invalid or expired"
          : "Authorization required (OAuth bearer token or X-Paperless-Token)",
      },
      { "WWW-Authenticate": `Bearer ${params.join(", ")}` },
    );
  }

  function consentOrigin(req: IncomingMessage): boolean {
    return (
      req.method === "POST" &&
      (req.url || "").split("?")[0] === "/oauth/consent" &&
      req.headers.origin === settings.publicUrl
    );
  }

  function protectedResource(res: ServerResponse) {
    json(res, 200, {
      resource: resourceUrl,
      authorization_servers: [settings.publicUrl],
      bearer_methods_supported: ["header"],
    });
  }

  function authorizationServer(res: ServerResponse) {
    json(res, 200, {
      issuer: settings.publicUrl,
      authorization_endpoint: `${settings.publicUrl}/authorize`,
      token_endpoint: `${settings.publicUrl}/token`,
      registration_endpoint: `${settings.publicUrl}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    });
  }

  async function register(req: IncomingMessage, res: ServerResponse) {
    const invalid = (description: string) =>
      json(res, 400, { error: "invalid_client_metadata", error_description: description });
    let body: unknown;
    try {
      body = JSON.parse((await readText(req)) || "{}");
    } catch (e) {
      invalid(e instanceof Error && e.message.includes("too large") ? e.message : "Invalid JSON");
      return;
    }
    const parsed = OAuthClientMetadataSchema.safeParse(body);
    if (!parsed.success) {
      invalid(parsed.error.message);
      return;
    }
    const meta = parsed.data;
    if (meta.redirect_uris.length > MAX_REDIRECT_URIS) {
      invalid(`At most ${MAX_REDIRECT_URIS} redirect_uris are allowed`);
      return;
    }
    if (meta.redirect_uris.some((u) => u.length > MAX_URI_LENGTH)) {
      invalid(`redirect_uris must be at most ${MAX_URI_LENGTH} characters`);
      return;
    }
    if ((meta.client_name || "").length > MAX_NAME_LENGTH) {
      invalid(`client_name must be at most ${MAX_NAME_LENGTH} characters`);
      return;
    }
    if (!clientHasRoom()) {
      json(res, 503, {
        error: "temporarily_unavailable",
        error_description: "Too many registered clients, try again later",
      });
      return;
    }
    const method =
      meta.token_endpoint_auth_method === "client_secret_post" ||
      meta.token_endpoint_auth_method === "client_secret_basic"
        ? meta.token_endpoint_auth_method
        : "none";
    const clientId = random();
    const secret = method === "none" ? undefined : random();
    const now = Date.now();
    clients.set(clientId, {
      name: meta.client_name || "",
      redirectUris: meta.redirect_uris,
      secretHash: secret ? sha256(secret) : undefined,
      created: now,
    });
    persist();
    json(res, 201, {
      ...meta,
      client_id: clientId,
      client_id_issued_at: Math.floor(now / 1000),
      token_endpoint_auth_method: method,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    });
  }

  function boundPending(req: IncomingMessage, key: string): Pending | null {
    const p = pending.get(key);
    if (!p || p.expires <= Date.now()) return null;
    const cookie = readCookie(req, cookieName(key));
    return cookie && safeEqual(sha256(cookie), p.binding) ? p : null;
  }

  function consentPage(
    res: ServerResponse,
    key: string,
    cookie: string,
    client: Client,
    redirectUri: string,
  ) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "Referrer-Policy": "same-origin",
      "Set-Cookie": `${cookieName(key)}=${cookie}; ${cookieAttrs}; Max-Age=${PENDING_TTL / 1000}`,
    });
    res.end(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Authorize Paperless access</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}code{word-break:break-all}button{margin-right:1rem;padding:.5rem 1rem;font:inherit}</style></head>
<body><h1>Authorize Paperless access</h1>
<p><strong>${escapeHtml(client.name || "An MCP client")}</strong> wants to access your Paperless documents through paperless-mcp. After you sign in, access is handed to:</p>
<p><code>${escapeHtml(redirectUri)}</code></p>
<p>Only continue if you started this connection yourself.</p>
<form method="post" action="/oauth/consent"><input type="hidden" name="id" value="${escapeHtml(key)}">
<button type="submit" name="action" value="approve">Continue to sign in</button><button type="submit" name="action" value="deny">Deny</button></form>
</body></html>`);
  }

  async function consent(req: IncomingMessage, res: ServerResponse) {
    let params: URLSearchParams;
    try {
      params = await readParams(req);
    } catch {
      text(res, 400, "Invalid request.");
      return;
    }
    const key = params.get("id") || "";
    const p = boundPending(req, key);
    if (!p || p.approved) {
      text(res, 400, "Authorization request expired or unknown. Start the sign-in again.");
      return;
    }
    const fail = (error: string, description: string) => {
      pending.delete(key);
      redirect(
        res,
        withParams(p.redirectUri, { error, error_description: description, state: p.state }),
        clearCookie(key),
        303,
      );
    };
    if (params.get("action") !== "approve") {
      fail("access_denied", "The user denied the request");
      return;
    }
    let idp: Discovery;
    try {
      idp = await discover();
    } catch {
      fail("temporarily_unavailable", "Identity provider discovery failed");
      return;
    }
    p.approved = true;
    p.expires = Date.now() + PENDING_TTL;
    redirect(
      res,
      withParams(idp.authorization_endpoint, {
        response_type: "code",
        client_id: settings.clientId,
        redirect_uri: callbackUrl,
        scope: settings.scopes,
        state: key,
        nonce: p.nonce,
        code_challenge: sha256(p.verifier),
        code_challenge_method: "S256",
      }),
      {},
      303,
    );
  }

  function makePendingRoom() {
    if (hasRoom(pending, limits.maxPending)) return;
    for (const k of pending.keys()) {
      if (pending.size < limits.maxPending) return;
      pending.delete(k);
    }
  }

  function authorize(url: URL, res: ServerResponse) {
    const q = url.searchParams;
    const client = clients.get(q.get("client_id") || "");
    const redirectUri = q.get("redirect_uri") || "";
    const state = q.get("state") || undefined;
    const scope = q.get("scope") || undefined;
    const codeChallenge = q.get("code_challenge") || "";
    const resource = q.get("resource");
    const error = !client
      ? "Unknown client_id. The server may have restarted; reconnect the server in your MCP client."
      : !client.redirectUris.includes(redirectUri)
        ? "redirect_uri is not registered for this client."
        : q.get("response_type") !== "code"
          ? "response_type must be code."
          : !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) || q.get("code_challenge_method") !== "S256"
            ? "PKCE with code_challenge_method=S256 is required."
            : resource && !resourceAllowed(resource)
              ? "Unknown resource."
              : (state?.length ?? 0) > MAX_PARAM_LENGTH || (scope?.length ?? 0) > MAX_PARAM_LENGTH
                ? "state or scope is too long."
                : null;
    if (error || !client) {
      text(res, 400, `Invalid authorization request: ${error}`);
      return;
    }
    makePendingRoom();
    const key = random();
    const cookie = random();
    pending.set(key, {
      clientId: q.get("client_id")!,
      redirectUri,
      codeChallenge,
      state,
      scope,
      nonce: random(),
      verifier: random(),
      binding: sha256(cookie),
      approved: false,
      expires: Date.now() + CONSENT_TTL,
    });
    consentPage(res, key, cookie, client, redirectUri);
  }

  async function exchangeCode(idp: Discovery, code: string, verifier: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl,
      code_verifier: verifier,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };
    const methods = idp.token_endpoint_auth_methods_supported || [];
    const basic =
      settings.clientSecret &&
      (settings.tokenAuthMethod
        ? settings.tokenAuthMethod === "client_secret_basic"
        : !methods.includes("client_secret_post") && methods.includes("client_secret_basic"));
    if (basic) {
      const credentials = `${formEncode(settings.clientId)}:${formEncode(settings.clientSecret)}`;
      headers.Authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
    } else {
      body.set("client_id", settings.clientId);
      if (settings.clientSecret) body.set("client_secret", settings.clientSecret);
    }
    const r = await fetch(idp.token_endpoint, { method: "POST", headers, body: body.toString() });
    if (!r.ok) throw new Error(`Identity provider token exchange failed (${r.status})`);
    const data = (await r.json()) as { id_token?: unknown };
    if (typeof data.id_token !== "string")
      throw new Error("Identity provider returned no id_token");
    return data.id_token;
  }

  async function paperlessLogin(idToken: string): Promise<string> {
    const r = await fetch(`${paperlessUrl}/api/auth/headless/app/v1/auth/provider/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        provider: settings.provider,
        process: "login",
        token: { client_id: settings.clientId, id_token: idToken },
      }),
    });
    if (!r.ok) throw new Error(paperlessError(r.status));
    const data = (await r.json()) as { meta?: { access_token?: unknown } };
    const token = data.meta?.access_token;
    if (typeof token !== "string" || !token) throw new Error("Paperless returned no access token");
    return token;
  }

  async function callback(req: IncomingMessage, url: URL, res: ServerResponse) {
    const q = url.searchParams;
    const key = q.get("state") || "";
    const p = boundPending(req, key);
    if (p) pending.delete(key);
    if (!p || !p.approved) {
      text(res, 400, "Authorization request expired or unknown. Start the sign-in again.");
      return;
    }
    const fail = (error: string, description: string) =>
      redirect(
        res,
        withParams(p.redirectUri, { error, error_description: description, state: p.state }),
        clearCookie(key),
      );
    const upstreamError = q.get("error");
    if (upstreamError) {
      fail(upstreamError, q.get("error_description") || "Sign-in at the identity provider failed");
      return;
    }
    try {
      const idp = await discover();
      const iss = q.get("iss");
      if (iss && idp.issuer && iss !== idp.issuer) throw new Error("Issuer mismatch");
      const idToken = await exchangeCode(idp, q.get("code") || "", p.verifier);
      if (decodeJwtPayload(idToken)?.nonce !== p.nonce) throw new Error("Nonce mismatch");
      const paperlessToken = await paperlessLogin(idToken);
      sweep(codes);
      if (codes.size >= limits.maxCodes) throw new Error("Server busy, try again");
      const code = random();
      const now = Date.now();
      codes.set(sha256(code), {
        grant: {
          id: random(),
          clientId: p.clientId,
          paperlessToken,
          scope: p.scope,
          expires: now + settings.refreshTokenTtl * 1000,
        },
        redirectUri: p.redirectUri,
        codeChallenge: p.codeChallenge,
        used: false,
        expires: now + CODE_TTL,
      });
      redirect(res, withParams(p.redirectUri, { code, state: p.state }), clearCookie(key));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`paperless-mcp OAuth sign-in failed: ${message}`);
      fail("access_denied", message);
    }
  }

  function authenticateClient(req: IncomingMessage, params: URLSearchParams): string | null {
    let id = params.get("client_id") || "";
    let secret = params.get("client_secret") || "";
    const auth = req.headers["authorization"];
    const m = typeof auth === "string" ? /^basic\s+(\S+)$/i.exec(auth.trim()) : null;
    if (m) {
      const decoded = Buffer.from(m[1], "base64").toString("utf8");
      const i = decoded.indexOf(":");
      if (i >= 0) {
        id = formDecode(decoded.slice(0, i));
        secret = formDecode(decoded.slice(i + 1));
      }
    }
    const client = clients.get(id);
    if (!client) return null;
    if (client.secretHash && !safeEqual(sha256(secret), client.secretHash)) return null;
    return id;
  }

  async function token(req: IncomingMessage, res: ServerResponse) {
    let params: URLSearchParams;
    try {
      params = await readParams(req);
    } catch {
      json(res, 400, { error: "invalid_request", error_description: "Invalid request body" });
      return;
    }
    let clientId: string | null;
    try {
      clientId = authenticateClient(req, params);
    } catch {
      clientId = null;
    }
    if (!clientId) {
      json(res, 401, {
        error: "invalid_client",
        error_description: "Client authentication failed",
      });
      return;
    }
    const grantType = params.get("grant_type");
    const invalidGrant = (description: string) =>
      json(res, 400, { error: "invalid_grant", error_description: description });
    const busy = () =>
      json(res, 503, {
        error: "temporarily_unavailable",
        error_description: "Too many active tokens, try again later",
      });
    if (grantType === "authorization_code") {
      sweep(codes);
      const code = codes.get(sha256(params.get("code") || ""));
      if (!code || code.grant.clientId !== clientId) {
        invalidGrant("Invalid or expired authorization code");
        return;
      }
      const redirectUri = params.get("redirect_uri");
      if (redirectUri && redirectUri !== code.redirectUri) {
        invalidGrant("redirect_uri mismatch");
        return;
      }
      if (!verifyPkce(params.get("code_verifier") || "", code.codeChallenge)) {
        invalidGrant("PKCE verification failed");
        return;
      }
      if (code.used) {
        revoke((g) => g.id === code.grant.id);
        invalidGrant("Authorization code was already used");
        return;
      }
      if (!hasRoom(access, limits.maxTokens) || !hasRoom(refresh, limits.maxTokens)) {
        busy();
        return;
      }
      code.used = true;
      json(res, 200, issue(code.grant));
      persist();
      return;
    }
    if (grantType === "refresh_token") {
      const key = sha256(params.get("refresh_token") || "");
      const entry = refresh.get(key);
      if (!entry || entry.expires <= Date.now() || entry.grant.clientId !== clientId) {
        invalidGrant("Invalid or expired refresh token");
        return;
      }
      const grant = entry.grant;
      const previousAccess = grant.accessKey;
      const accessEntry = previousAccess ? access.get(previousAccess) : undefined;
      const tokens = issue(grant);
      if (!persist(true)) {
        access.delete(grant.accessKey!);
        refresh.delete(grant.refreshKey!);
        grant.accessKey = previousAccess;
        grant.refreshKey = key;
        if (previousAccess && accessEntry) access.set(previousAccess, accessEntry);
        refresh.set(key, entry);
        json(res, 503, {
          error: "temporarily_unavailable",
          error_description: "Could not save the refreshed token, try again later",
        });
        return;
      }
      json(res, 200, tokens);
      return;
    }
    json(res, 400, { error: "unsupported_grant_type" });
  }

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const route = `${req.method} ${url.pathname}`;
    switch (route) {
      case "GET /.well-known/oauth-protected-resource":
      case "GET /.well-known/oauth-protected-resource/mcp":
        protectedResource(res);
        return true;
      case "GET /.well-known/oauth-authorization-server":
        authorizationServer(res);
        return true;
      case "POST /register":
        await register(req, res);
        return true;
      case "GET /authorize":
        authorize(url, res);
        return true;
      case "POST /oauth/consent":
        await consent(req, res);
        return true;
      case "GET /oauth/callback":
        await callback(req, url, res);
        return true;
      case "POST /token":
        await token(req, res);
        return true;
    }
    return false;
  }

  return {
    handle,
    resolve,
    challenge,
    consentOrigin,
    revokePaperlessToken,
    resourceMetadataUrl,
    flush,
  };
}

export type OAuth = ReturnType<typeof createOAuth>;
