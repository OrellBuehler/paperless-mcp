import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { OAuthClientMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { checkResourceAllowed } from "@modelcontextprotocol/sdk/shared/auth-utils.js";

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

export interface Credential {
  key: string;
  token: string;
  oauth: boolean;
}

interface Client {
  name: string;
  redirectUris: string[];
  secretHash?: string;
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
}

interface Code {
  grant: Grant;
  redirectUri: string;
  codeChallenge: string;
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

const PENDING_TTL = 600_000;
const CODE_TTL = 60_000;
const MAX_ENTRIES = 10_000;
const MAX_BODY = 64 * 1024;
const COOKIE = "paperless_mcp_oauth";

function positiveInt(value: string, fallback: number): number {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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
  const publicUrl = new URL(get("MCP_PUBLIC_URL")).origin;
  return {
    issuer: get("MCP_OAUTH_ISSUER").replace(/\/+$/, ""),
    clientId: get("MCP_OAUTH_CLIENT_ID"),
    clientSecret: get("MCP_OAUTH_CLIENT_SECRET"),
    provider: get("MCP_OAUTH_PAPERLESS_PROVIDER"),
    publicUrl,
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

function put<K, V>(map: Map<K, V>, key: K, value: V) {
  if (map.size >= MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

function sweep(map: Map<string, { expires: number }>) {
  const now = Date.now();
  for (const [k, v] of map) if (v.expires <= now) map.delete(k);
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

function redirect(res: ServerResponse, location: string, headers: Headers = {}) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store", ...headers });
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

export function createOAuth(settings: OAuthSettings, paperlessUrl: string) {
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

  function issue(grant: Grant) {
    sweep(access);
    sweep(refresh);
    const accessToken = random();
    const refreshToken = random();
    const now = Date.now();
    put(access, sha256(accessToken), { grant, expires: now + settings.accessTokenTtl * 1000 });
    put(refresh, sha256(refreshToken), { grant, expires: now + settings.refreshTokenTtl * 1000 });
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: settings.accessTokenTtl,
      refresh_token: refreshToken,
      ...(grant.scope ? { scope: grant.scope } : {}),
    };
  }

  function resolve(headers: Headers): Credential | null {
    const auth = headers["authorization"];
    if (typeof auth === "string" && auth.startsWith("Bearer ")) {
      const t = auth.slice("Bearer ".length).trim();
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
    const presented =
      typeof headers["authorization"] === "string" &&
      headers["authorization"].startsWith("Bearer ");
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

  function revokePaperlessToken(token: string) {
    for (const map of [access, refresh])
      for (const [k, v] of map) if (v.grant.paperlessToken === token) map.delete(k);
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
    let body: unknown;
    try {
      body = JSON.parse((await readText(req)) || "{}");
    } catch {
      json(res, 400, { error: "invalid_client_metadata", error_description: "Invalid JSON" });
      return;
    }
    const parsed = OAuthClientMetadataSchema.safeParse(body);
    if (!parsed.success) {
      json(res, 400, { error: "invalid_client_metadata", error_description: parsed.error.message });
      return;
    }
    const meta = parsed.data;
    const method =
      meta.token_endpoint_auth_method === "client_secret_post" ||
      meta.token_endpoint_auth_method === "client_secret_basic"
        ? meta.token_endpoint_auth_method
        : "none";
    const clientId = random();
    const secret = method === "none" ? undefined : random();
    put(clients, clientId, {
      name: meta.client_name || "",
      redirectUris: meta.redirect_uris,
      secretHash: secret ? sha256(secret) : undefined,
    });
    json(res, 201, {
      ...meta,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: method,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    });
  }

  function boundPending(req: IncomingMessage, key: string): Pending | null {
    const p = pending.get(key);
    if (!p || p.expires <= Date.now()) return null;
    const cookie = readCookie(req, COOKIE);
    return cookie && safeEqual(sha256(cookie), p.binding) ? p : null;
  }

  function consentPage(
    res: ServerResponse,
    key: string,
    cookie: string,
    client: Client,
    redirectUri: string,
  ) {
    const link = (action: string) =>
      escapeHtml(`/oauth/consent?id=${encodeURIComponent(key)}&action=${action}`);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": `${COOKIE}=${cookie}; ${cookieAttrs}; Max-Age=${PENDING_TTL / 1000}`,
    });
    res.end(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Authorize Paperless access</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}code{word-break:break-all}a{display:inline-block;margin-right:1rem;padding:.5rem 1rem;border:1px solid #888;border-radius:.375rem;text-decoration:none}</style></head>
<body><h1>Authorize Paperless access</h1>
<p><strong>${escapeHtml(client.name || "An MCP client")}</strong> wants to access your Paperless documents through paperless-mcp. After you sign in, access is handed to:</p>
<p><code>${escapeHtml(redirectUri)}</code></p>
<p>Only continue if you started this connection yourself.</p>
<p><a href="${link("approve")}">Continue to sign in</a><a href="${link("deny")}">Deny</a></p>
</body></html>`);
  }

  async function consent(req: IncomingMessage, url: URL, res: ServerResponse) {
    const key = url.searchParams.get("id") || "";
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
      );
    };
    if (url.searchParams.get("action") !== "approve") {
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
    );
  }

  async function authorize(url: URL, res: ServerResponse) {
    const q = url.searchParams;
    const clientId = q.get("client_id") || "";
    const redirectUri = q.get("redirect_uri") || "";
    const client = clients.get(clientId);
    if (!client) {
      text(
        res,
        400,
        "Unknown client_id. The server may have restarted; reconnect the server in your MCP client.",
      );
      return;
    }
    if (!client.redirectUris.includes(redirectUri)) {
      text(res, 400, "redirect_uri is not registered for this client.");
      return;
    }
    const state = q.get("state") || undefined;
    const fail = (error: string, description: string) =>
      redirect(res, withParams(redirectUri, { error, error_description: description, state }));
    if (q.get("response_type") !== "code") {
      fail("unsupported_response_type", "response_type must be code");
      return;
    }
    const codeChallenge = q.get("code_challenge") || "";
    if (!codeChallenge || q.get("code_challenge_method") !== "S256") {
      fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
      return;
    }
    const resource = q.get("resource");
    if (resource && !resourceAllowed(resource)) {
      fail("invalid_target", "Unknown resource");
      return;
    }
    sweep(pending);
    const key = random();
    const cookie = random();
    put(pending, key, {
      clientId,
      redirectUri,
      codeChallenge,
      state,
      scope: q.get("scope") || undefined,
      nonce: random(),
      verifier: random(),
      binding: sha256(cookie),
      approved: false,
      expires: Date.now() + PENDING_TTL,
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
      headers.Authorization = `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString("base64")}`;
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
    const clear = { "Set-Cookie": `${COOKIE}=; ${cookieAttrs}; Max-Age=0` };
    const fail = (error: string, description: string) =>
      redirect(
        res,
        withParams(p.redirectUri, { error, error_description: description, state: p.state }),
        clear,
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
      const code = random();
      put(codes, sha256(code), {
        grant: { id: random(), clientId: p.clientId, paperlessToken, scope: p.scope },
        redirectUri: p.redirectUri,
        codeChallenge: p.codeChallenge,
        expires: Date.now() + CODE_TTL,
      });
      redirect(res, withParams(p.redirectUri, { code, state: p.state }), clear);
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
    if (typeof auth === "string" && auth.startsWith("Basic ")) {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      const i = decoded.indexOf(":");
      if (i >= 0) {
        id = decodeURIComponent(decoded.slice(0, i));
        secret = decodeURIComponent(decoded.slice(i + 1));
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
    if (grantType === "authorization_code") {
      const key = sha256(params.get("code") || "");
      const code = codes.get(key);
      codes.delete(key);
      if (!code || code.expires <= Date.now() || code.grant.clientId !== clientId) {
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
      json(res, 200, issue(code.grant));
      return;
    }
    if (grantType === "refresh_token") {
      const key = sha256(params.get("refresh_token") || "");
      const entry = refresh.get(key);
      if (!entry || entry.expires <= Date.now() || entry.grant.clientId !== clientId) {
        invalidGrant("Invalid or expired refresh token");
        return;
      }
      refresh.delete(key);
      json(res, 200, issue(entry.grant));
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
        await authorize(url, res);
        return true;
      case "GET /oauth/consent":
        await consent(req, url, res);
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

  return { handle, resolve, challenge, revokePaperlessToken, resourceMetadataUrl };
}

export type OAuth = ReturnType<typeof createOAuth>;
