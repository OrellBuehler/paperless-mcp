import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer as createNodeServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";

vi.stubEnv("PAPERLESS_URL", "https://p.example.com");
vi.stubEnv("PAPERLESS_TOKEN", "admin-tok");

const { createHttpHandler } = await import("../http.js");
const { config, clientFor } = await import("../config.js");
const { createOAuth, oauthSettingsFromEnv, verifyPkce, decodeJwtPayload, DEFAULT_LIMITS } =
  await import("../oauth.js");

const realFetch = globalThis.fetch;
const INIT = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "1" },
  },
});
const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

async function listen(handler: ReturnType<typeof createHttpHandler>) {
  const server = createNodeServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function close(server: Server) {
  return new Promise((r) => server.close(r));
}

function jwt(payload: Record<string, unknown>) {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(payload)}.sig`;
}

const challengeFor = (v: string) => createHash("sha256").update(v).digest("base64url");

describe("http transport defaults (OAuth disabled)", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    ({ server, base } = await listen(createHttpHandler()));
  });
  afterAll(() => close(server));

  it("leaves OAuth disabled without MCP_OAUTH_ISSUER", () => {
    expect(config.oauthEnabled).toBe(false);
  });

  it("serves no OAuth endpoints", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-authorization-server",
      "/authorize",
      "/oauth/callback",
    ]) {
      expect((await realFetch(`${base}${path}`)).status).toBe(404);
    }
    expect((await realFetch(`${base}/token`, { method: "POST" })).status).toBe(404);
    expect((await realFetch(`${base}/register`, { method: "POST" })).status).toBe(404);
    expect((await realFetch(`${base}/oauth/consent`, { method: "POST" })).status).toBe(404);
    const foreign = await realFetch(`${base}/oauth/consent`, {
      method: "POST",
      headers: { Origin: "https://mcp.example.com" },
    });
    expect(foreign.status).toBe(403);
  });

  it("returns the same 401 without a token and no WWW-Authenticate", async () => {
    const r = await realFetch(`${base}/mcp`, { method: "POST", headers: MCP_HEADERS, body: INIT });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBeNull();
    expect(await r.text()).toBe(
      JSON.stringify({ error: "Missing Paperless token (Authorization: Bearer <token>)" }),
    );
  });

  it("keeps the same CORS headers", async () => {
    const r = await realFetch(`${base}/mcp`, { method: "OPTIONS" });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-methods")).toBe("GET, POST, DELETE, OPTIONS");
    expect(r.headers.get("access-control-allow-headers")).toBe(
      "Content-Type, Authorization, X-Paperless-Token, mcp-session-id",
    );
    expect(r.headers.get("access-control-expose-headers")).toBe("mcp-session-id");
  });

  it("accepts raw Bearer and X-Paperless-Token tokens and binds sessions to them", async () => {
    const r = await realFetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: "Bearer raw-tok" },
      body: INIT,
    });
    expect(r.status).toBe(200);
    const sid = r.headers.get("mcp-session-id")!;
    await r.text();
    const other = await realFetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, "mcp-session-id": sid, Authorization: "Bearer other" },
      body: INIT,
    });
    expect(other.status).toBe(404);
    expect(await other.text()).toBe(JSON.stringify({ error: "Unknown or expired session" }));

    const x = await realFetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, "X-Paperless-Token": "raw-tok" },
      body: INIT,
    });
    expect(x.status).toBe(200);
  });
});

describe("oauthSettingsFromEnv", () => {
  it("lists missing required variables", () => {
    expect(() => oauthSettingsFromEnv({ MCP_OAUTH_ISSUER: "https://idp" })).toThrow(
      "MCP_OAUTH_CLIENT_ID, MCP_OAUTH_PAPERLESS_PROVIDER, MCP_PUBLIC_URL",
    );
  });

  it("applies defaults", () => {
    const s = oauthSettingsFromEnv({
      MCP_OAUTH_ISSUER: "https://idp.example.com/",
      MCP_OAUTH_CLIENT_ID: "cid",
      MCP_OAUTH_PAPERLESS_PROVIDER: "authentik",
      MCP_PUBLIC_URL: "https://mcp.example.com/",
    });
    expect(s).toMatchObject({
      issuer: "https://idp.example.com",
      publicUrl: "https://mcp.example.com",
      clientSecret: "",
      scopes: "openid email profile",
      accessTokenTtl: 3600,
      refreshTokenTtl: 2592000,
    });
  });
});

describe("MCP_PUBLIC_URL validation", () => {
  const env = (url: string) => ({
    MCP_OAUTH_ISSUER: "https://idp.example.com",
    MCP_OAUTH_CLIENT_ID: "cid",
    MCP_OAUTH_PAPERLESS_PROVIDER: "authentik",
    MCP_PUBLIC_URL: url,
  });
  afterEach(() => vi.restoreAllMocks());

  it("rejects a path, query or invalid URL", () => {
    expect(() => oauthSettingsFromEnv(env("https://mcp.example.com/paperless"))).toThrow(
      "must be an origin without a path",
    );
    expect(() => oauthSettingsFromEnv(env("https://mcp.example.com/?x=1"))).toThrow(
      "must be an origin without a path",
    );
    expect(() => oauthSettingsFromEnv(env("not a url"))).toThrow("not a valid URL");
  });

  it("warns about plain http except on localhost", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    oauthSettingsFromEnv(env("http://localhost:3001"));
    oauthSettingsFromEnv(env("http://127.0.0.1:3001"));
    oauthSettingsFromEnv(env("https://mcp.example.com"));
    expect(warn).not.toHaveBeenCalled();
    expect(oauthSettingsFromEnv(env("http://mcp.lan:3001")).publicUrl).toBe("http://mcp.lan:3001");
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("verifyPkce", () => {
  const v = "dBjftJeZ4CVP-mJ92K1QDuNnknC4XEQZvTmZrjo-jXk";
  it("accepts a verifier matching its S256 challenge", () =>
    expect(verifyPkce(v, challengeFor(v))).toBe(true));
  it("rejects a wrong or malformed verifier", () => {
    expect(verifyPkce(`${v.slice(0, -1)}X`, challengeFor(v))).toBe(false);
    expect(verifyPkce(v, v)).toBe(false);
    expect(verifyPkce("short", challengeFor("short"))).toBe(false);
  });
  it("decodes JWT payloads without verifying", () => {
    expect(decodeJwtPayload(jwt({ nonce: "n" }))).toEqual({ nonce: "n" });
    expect(decodeJwtPayload("garbage")).toBeNull();
  });
});

describe("OAuth mode", () => {
  const settings = {
    issuer: "https://idp.example.com",
    clientId: "paperless-client",
    clientSecret: "idp-secret",
    provider: "authentik",
    publicUrl: "https://mcp.example.com",
    scopes: "openid email profile",
    tokenAuthMethod: "",
    accessTokenTtl: 3600,
    refreshTokenTtl: 86400,
  };
  const redirectUri = "http://localhost:9999/cb";
  const verifier = "v".repeat(50);
  let oauth: ReturnType<typeof createOAuth>;
  let server: Server;
  let base: string;
  let calls: { url: string; init?: RequestInit }[];
  let idTokenNonce: (nonce: string) => string;
  let paperlessResponse: () => Response;
  const idpNonces = new Map<string, string>();

  async function restart(limits = {}, overrides = {}) {
    if (server) await close(server);
    oauth = createOAuth({ ...settings, ...overrides }, "https://p.example.com", {
      ...DEFAULT_LIMITS,
      ...limits,
    });
    ({ server, base } = await listen(createHttpHandler(oauth)));
  }

  beforeEach(async () => {
    await restart();
    calls = [];
    idTokenNonce = (nonce) => nonce;
    paperlessResponse = () =>
      new Response(JSON.stringify({ status: 200, meta: { access_token: "user-tok" } }), {
        status: 200,
      });
    let lastNonce = "";
    idpNonces.clear();
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(base)) return realFetch(input, init);
      calls.push({ url, init });
      if (url === "https://idp.example.com/.well-known/openid-configuration")
        return new Response(
          JSON.stringify({
            issuer: "https://idp.example.com",
            authorization_endpoint: "https://idp.example.com/auth",
            token_endpoint: "https://idp.example.com/token",
            token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
          }),
        );
      if (url === "https://idp.example.com/token") {
        const code = new URLSearchParams(String(init?.body)).get("code")!;
        const nonce = idpNonces.get(code) ?? lastNonce;
        return new Response(JSON.stringify({ id_token: jwt({ nonce: idTokenNonce(nonce) }) }));
      }
      if (url === "https://p.example.com/api/auth/headless/app/v1/auth/provider/token")
        return paperlessResponse();
      throw new Error(`unexpected fetch ${url}`);
    });
    const track = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const r = await track(input, init);
      const loc = r.headers.get("location");
      if (loc?.startsWith("https://idp.example.com/auth"))
        lastNonce = new URL(loc).searchParams.get("nonce")!;
      return r;
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await close(server);
  });

  function rawRegister(body: Record<string, unknown> = {}) {
    return fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "test", ...body }),
    });
  }

  async function registerClient(body: Record<string, unknown> = {}) {
    const r = await rawRegister(body);
    expect(r.status).toBe(201);
    return (await r.json()) as { client_id: string; client_secret?: string };
  }

  async function authorize(clientId: string, extra: Record<string, string> = {}) {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challengeFor(verifier),
      code_challenge_method: "S256",
      state: "client-state",
      resource: "https://mcp.example.com/mcp",
      ...extra,
    });
    return fetch(`${base}/authorize?${q}`, { redirect: "manual" });
  }

  async function startConsent(clientId: string) {
    const a = await authorize(clientId);
    expect(a.status).toBe(200);
    const cookie = a.headers.get("set-cookie")!.split(";")[0];
    const id = /name="id" value="([^"]+)"/.exec(await a.text())![1];
    return { cookie, id };
  }

  function postConsent(id: string, action: string, cookie: string, origin?: string) {
    return fetch(`${base}/oauth/consent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
        ...(origin ? { Origin: origin } : {}),
      },
      body: new URLSearchParams({ id, action }).toString(),
      redirect: "manual",
    });
  }

  async function approve(clientId: string) {
    const { cookie, id } = await startConsent(clientId);
    const r = await postConsent(id, "approve", cookie);
    expect(r.status).toBe(303);
    return { cookie, idp: new URL(r.headers.get("location")!) };
  }

  async function finish(cookie: string, idp: URL, code = "idp-code") {
    if (code !== "idp-code") idpNonces.set(code, idp.searchParams.get("nonce")!);
    const cb = await fetch(
      `${base}/oauth/callback?code=${code}&state=${idp.searchParams.get("state")}`,
      { headers: { Cookie: cookie }, redirect: "manual" },
    );
    expect(cb.status).toBe(302);
    return new URL(cb.headers.get("location")!);
  }

  async function signIn(clientId: string) {
    const { cookie, idp } = await approve(clientId);
    return finish(cookie, idp);
  }

  async function exchange(params: Record<string, string>) {
    return fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
  }

  async function login() {
    const { client_id } = await registerClient();
    const back = await signIn(client_id);
    const r = await exchange({
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      code_verifier: verifier,
      client_id,
      redirect_uri: redirectUri,
    });
    expect(r.status).toBe(200);
    return { client_id, tokens: (await r.json()) as Record<string, string | number> };
  }

  it("serves protected resource and authorization server metadata", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      expect(await (await fetch(`${base}${path}`)).json()).toEqual({
        resource: "https://mcp.example.com/mcp",
        authorization_servers: ["https://mcp.example.com"],
        bearer_methods_supported: ["header"],
      });
    }
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    expect(as).toMatchObject({
      issuer: "https://mcp.example.com",
      authorization_endpoint: "https://mcp.example.com/authorize",
      token_endpoint: "https://mcp.example.com/token",
      registration_endpoint: "https://mcp.example.com/register",
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("answers /mcp without a token with a resource_metadata challenge", async () => {
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: MCP_HEADERS, body: INIT });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
    );
    expect(r.headers.get("access-control-expose-headers")).toBe("mcp-session-id, WWW-Authenticate");
  });

  it("rejects unknown bearer tokens, including raw Paperless tokens", async () => {
    const r = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: "Bearer raw-paperless-token" },
      body: INIT,
    });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("still accepts raw Paperless tokens via X-Paperless-Token", async () => {
    const r = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, "X-Paperless-Token": "service-tok" },
      body: INIT,
    });
    expect(r.status).toBe(200);
    expect(oauth.resolve({ "x-paperless-token": "service-tok" })?.token).toBe("service-tok");
  });

  it("shows a consent page bound to a browser cookie", async () => {
    const { client_id } = await registerClient({ client_name: "<b>Evil</b>" });
    const r = await authorize(client_id);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("set-cookie")).toMatch(
      /^paperless_mcp_oauth_[\w-]{16}=.+; Path=\/oauth; HttpOnly; SameSite=Lax; Secure/,
    );
    const html = await r.text();
    expect(html).toContain('<form method="post" action="/oauth/consent">');
    expect(html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
    expect(html).not.toContain("<b>Evil</b>");
    expect(html).toContain(redirectUri);
  });

  it("refuses consent and callback from a browser without the flow cookie", async () => {
    const { client_id } = await registerClient();
    const { id } = await startConsent(client_id);
    const consent = await postConsent(id, "approve", "paperless_mcp_oauth_x=other");
    expect(consent.status).toBe(400);
    const viaGet = await fetch(`${base}/oauth/consent?id=${id}&action=approve`, {
      redirect: "manual",
    });
    expect(viaGet.status).toBe(404);

    const { idp } = await approve(client_id);
    const cb = await fetch(
      `${base}/oauth/callback?code=idp-code&state=${idp.searchParams.get("state")}`,
      { redirect: "manual" },
    );
    expect(cb.status).toBe(400);
    expect(calls.some((c) => c.url === "https://idp.example.com/token")).toBe(false);
  });

  it("returns access_denied when the user denies consent", async () => {
    const { client_id } = await registerClient();
    const { cookie, id } = await startConsent(client_id);
    const r = await postConsent(id, "deny", cookie);
    expect(r.status).toBe(303);
    expect(r.headers.get("set-cookie")).toContain("Max-Age=0");
    const back = new URL(r.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(redirectUri);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("client-state");
  });

  it("redirects to the IdP with its own state, nonce and PKCE after consent", async () => {
    const { client_id } = await registerClient();
    const { idp: loc } = await approve(client_id);
    expect(loc.origin + loc.pathname).toBe("https://idp.example.com/auth");
    const q = loc.searchParams;
    expect(q.get("client_id")).toBe("paperless-client");
    expect(q.get("redirect_uri")).toBe("https://mcp.example.com/oauth/callback");
    expect(q.get("scope")).toBe("openid email profile");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("state")).not.toBe("client-state");
    expect(q.get("nonce")).toBeTruthy();
    expect(q.get("code_challenge")).not.toBe(challengeFor(verifier));
  });

  it("rejects invalid /authorize requests with an error page, never a redirect", async () => {
    const { client_id } = await registerClient();
    for (const [clientId, extra] of [
      ["nope", {}],
      [client_id, { redirect_uri: "https://evil.example.com/cb" }],
      [client_id, { response_type: "token" }],
      [client_id, { code_challenge_method: "plain" }],
      [client_id, { code_challenge: "short" }],
      [client_id, { resource: "https://other.example.com/mcp" }],
      [client_id, { state: "s".repeat(1001) }],
    ] as [string, Record<string, string>][]) {
      const r = await authorize(clientId, extra);
      expect(r.status).toBe(400);
      expect(r.headers.get("location")).toBeNull();
      expect(r.headers.get("content-type")).toContain("text/plain");
    }
  });

  it("allows the consent POST from its own origin only", async () => {
    const { client_id } = await registerClient();
    const own = await startConsent(client_id);
    expect(
      (await postConsent(own.id, "approve", own.cookie, "https://mcp.example.com")).status,
    ).toBe(303);
    const other = await startConsent(client_id);
    expect(
      (await postConsent(other.id, "approve", other.cookie, "https://evil.example.com")).status,
    ).toBe(403);
    const r = await fetch(`${base}/token`, {
      method: "POST",
      headers: { Origin: "https://mcp.example.com" },
    });
    expect(r.status).toBe(403);
  });

  it("supports parallel authorizations in one browser", async () => {
    const { client_id } = await registerClient();
    const a = await startConsent(client_id);
    const b = await startConsent(client_id);
    expect(a.cookie.split("=")[0]).not.toBe(b.cookie.split("=")[0]);
    const jar = `${a.cookie}; ${b.cookie}`;
    const ra = await postConsent(a.id, "approve", jar);
    const rb = await postConsent(b.id, "approve", jar);
    const backB = await finish(jar, new URL(rb.headers.get("location")!), "code-b");
    const backA = await finish(jar, new URL(ra.headers.get("location")!), "code-a");
    expect(backA.searchParams.get("code")).toBeTruthy();
    expect(backB.searchParams.get("code")).toBeTruthy();
  });

  it("runs authorize -> callback -> token and resolves to the Paperless token", async () => {
    const { client_id } = await registerClient();
    const back = await signIn(client_id);
    expect(back.origin + back.pathname).toBe(redirectUri);
    expect(back.searchParams.get("state")).toBe("client-state");

    const idpToken = calls.find((c) => c.url === "https://idp.example.com/token")!;
    const idpBody = new URLSearchParams(String(idpToken.init!.body));
    expect(idpBody.get("grant_type")).toBe("authorization_code");
    expect(idpBody.get("code")).toBe("idp-code");
    expect(idpBody.get("redirect_uri")).toBe("https://mcp.example.com/oauth/callback");
    expect(idpBody.get("client_id")).toBe("paperless-client");
    expect(idpBody.get("client_secret")).toBe("idp-secret");
    expect(idpBody.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const headless = calls.find((c) => c.url.includes("/api/auth/headless/"))!;
    expect(headless.init!.method).toBe("POST");
    const body = JSON.parse(String(headless.init!.body));
    expect(body).toMatchObject({
      provider: "authentik",
      process: "login",
      token: { client_id: "paperless-client" },
    });
    expect(typeof body.token.id_token).toBe("string");

    const r = await exchange({
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      code_verifier: verifier,
      client_id,
      redirect_uri: redirectUri,
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const tokens = await r.json();
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(tokens.access_token).not.toBe("user-tok");
    expect(oauth.resolve({ authorization: `Bearer ${tokens.access_token}` })?.token).toBe(
      "user-tok",
    );

    const mcp = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${tokens.access_token}` },
      body: INIT,
    });
    expect(mcp.status).toBe(200);
    expect(mcp.headers.get("mcp-session-id")).toBeTruthy();
  });

  it("revokes tokens issued from a reused authorization code", async () => {
    const { client_id } = await registerClient();
    const back = await signIn(client_id);
    const params = {
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      code_verifier: verifier,
      client_id,
    };
    const first = await (await exchange(params)).json();
    expect(oauth.resolve({ authorization: `Bearer ${first.access_token}` })).not.toBeNull();
    const again = await exchange(params);
    expect((await again.json()).error).toBe("invalid_grant");
    expect(oauth.resolve({ authorization: `Bearer ${first.access_token}` })).toBeNull();
    const refreshed = await exchange({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id,
    });
    expect(refreshed.status).toBe(400);
  });

  it("rejects a wrong code_verifier and code reuse", async () => {
    const { client_id } = await registerClient();
    const back = await signIn(client_id);
    const code = back.searchParams.get("code")!;
    const bad = await exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: "w".repeat(50),
      client_id,
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_grant");
    const good = { grant_type: "authorization_code", code, code_verifier: verifier, client_id };
    expect((await exchange(good)).status).toBe(200);
    expect((await (await exchange(good)).json()).error).toBe("invalid_grant");
  });

  it("requires the client secret for confidential clients", async () => {
    const { client_id, client_secret } = await registerClient({
      token_endpoint_auth_method: "client_secret_basic",
    });
    expect(client_secret).toBeTruthy();
    const back = await signIn(client_id);
    const params = {
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      code_verifier: verifier,
      client_id,
    };
    expect((await exchange({ ...params, client_secret: "wrong" })).status).toBe(401);
    const ok = await fetch(`${base}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${client_id}:${client_secret}`).toString("base64")}`,
      },
      body: new URLSearchParams(params).toString(),
    });
    expect(ok.status).toBe(200);
  });

  it("rejects a mismatched nonce", async () => {
    idTokenNonce = () => "other";
    const { client_id } = await registerClient();
    const back = await signIn(client_id);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
    expect(calls.some((c) => c.url.includes("/api/auth/headless/"))).toBe(false);
  });

  it("reports Paperless refusing the sign-in", async () => {
    paperlessResponse = () => new Response(JSON.stringify({ status: 403 }), { status: 403 });
    const { client_id } = await registerClient();
    const back = await signIn(client_id);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("error_description")).toContain("signups closed");
  });

  it("accepts the Bearer scheme case-insensitively in OAuth mode", async () => {
    const { tokens } = await login();
    expect(oauth.resolve({ authorization: `bearer ${tokens.access_token}` })?.token).toBe(
      "user-tok",
    );
    expect(oauth.resolve({ authorization: `BEARER  ${tokens.access_token}` })?.token).toBe(
      "user-tok",
    );
  });

  it("form-urlencodes client credentials for IdP basic auth", async () => {
    await restart(
      {},
      {
        clientId: "paperless client",
        clientSecret: "s:e+c/r%t",
        tokenAuthMethod: "client_secret_basic",
      },
    );
    const { client_id } = await registerClient();
    await signIn(client_id);
    const idpToken = calls.find((c) => c.url === "https://idp.example.com/token")!;
    const auth = (idpToken.init!.headers as Record<string, string>).Authorization;
    expect(Buffer.from(auth.replace("Basic ", ""), "base64").toString()).toBe(
      "paperless+client:s%3Ae%2Bc%2Fr%25t",
    );
    expect(new URLSearchParams(String(idpToken.init!.body)).get("client_secret")).toBeNull();
  });

  it("limits grants to an absolute lifetime that refreshing cannot extend", async () => {
    await restart({}, { accessTokenTtl: 3600, refreshTokenTtl: 5400 });
    vi.useFakeTimers({ toFake: ["Date"] });
    const { client_id, tokens } = await login();
    vi.setSystemTime(Date.now() + 3000 * 1000);
    const r = await exchange({
      grant_type: "refresh_token",
      refresh_token: String(tokens.refresh_token),
      client_id,
    });
    const next = await r.json();
    expect(next.expires_in).toBeLessThanOrEqual(2400);
    expect(next.expires_in).toBeGreaterThan(2390);
    vi.setSystemTime(Date.now() + 2401 * 1000);
    expect(oauth.resolve({ authorization: `Bearer ${next.access_token}` })).toBeNull();
    const late = await exchange({
      grant_type: "refresh_token",
      refresh_token: next.refresh_token,
      client_id,
    });
    expect((await late.json()).error).toBe("invalid_grant");
  });

  it("rejects expired access tokens", async () => {
    const { tokens } = await login();
    const header = { authorization: `Bearer ${tokens.access_token}` };
    expect(oauth.resolve(header)).not.toBeNull();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 3601 * 1000);
    expect(oauth.resolve(header)).toBeNull();
  });

  it("rotates refresh tokens and keeps the session bound to the grant", async () => {
    const { client_id, tokens } = await login();
    const init = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${tokens.access_token}` },
      body: INIT,
    });
    const sid = init.headers.get("mcp-session-id")!;
    await init.text();

    const r = await exchange({
      grant_type: "refresh_token",
      refresh_token: String(tokens.refresh_token),
      client_id,
    });
    expect(r.status).toBe(200);
    const next = await r.json();
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(oauth.resolve({ authorization: `Bearer ${next.access_token}` })?.token).toBe("user-tok");
    expect(oauth.resolve({ authorization: `Bearer ${tokens.access_token}` })).toBeNull();
    const reuse = await exchange({
      grant_type: "refresh_token",
      refresh_token: String(tokens.refresh_token),
      client_id,
    });
    expect((await reuse.json()).error).toBe("invalid_grant");

    const same = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        Authorization: `Bearer ${next.access_token}`,
        "mcp-session-id": sid,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
    });
    expect(same.status).toBe(200);
  });

  it("revokes grants when Paperless rejects the token", async () => {
    const { tokens } = await login();
    const init = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${tokens.access_token}` },
      body: INIT,
    });
    await init.text();
    const client = clientFor("user-tok");
    expect(client.onUnauthorized).toBeTypeOf("function");
    client.onUnauthorized!();
    expect(oauth.resolve({ authorization: `Bearer ${tokens.access_token}` })).toBeNull();
    const after = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${tokens.access_token}` },
      body: INIT,
    });
    expect(after.status).toBe(401);
    expect(after.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("bounds /register input", async () => {
    const big = await rawRegister({ client_name: "x".repeat(9000) });
    expect(big.status).toBe(400);
    expect((await big.json()).error).toBe("invalid_client_metadata");
    const many = await rawRegister({
      redirect_uris: Array.from({ length: 11 }, (_, i) => `http://localhost/${i}`),
    });
    expect(many.status).toBe(400);
    const longUri = await rawRegister({ redirect_uris: [`http://localhost/${"a".repeat(2001)}`] });
    expect(longUri.status).toBe(400);
    const longName = await rawRegister({ client_name: "n".repeat(201) });
    expect(longName.status).toBe(400);
  });

  it("rejects registrations when full instead of evicting live clients", async () => {
    await restart({ maxClients: 2 });
    vi.useFakeTimers({ toFake: ["Date"] });
    const { client_id, tokens } = await login();
    await registerClient();
    const full = await rawRegister();
    expect(full.status).toBe(503);
    expect((await full.json()).error).toBe("temporarily_unavailable");

    vi.setSystemTime(Date.now() + 601 * 1000);
    await registerClient();
    expect((await rawRegister()).status).toBe(503);
    const r = await exchange({
      grant_type: "refresh_token",
      refresh_token: String(tokens.refresh_token),
      client_id,
    });
    expect(r.status).toBe(200);
  });

  it("evicts unconsented sign-ins instead of rejecting when pending is full", async () => {
    await restart({ maxPending: 3 });
    const attacker = await registerClient();
    for (let n = 0; n < 5; n++) await startConsent(attacker.client_id);
    const { client_id } = await registerClient();
    const back = await signIn(client_id);
    expect(back.searchParams.get("code")).toBeTruthy();
  });

  it("prefers evicting unconsented sign-ins over approved ones", async () => {
    await restart({ maxPending: 2 });
    const { client_id } = await registerClient();
    const { cookie, idp } = await approve(client_id);
    await startConsent(client_id);
    await startConsent(client_id);
    await startConsent(client_id);
    const back = await finish(cookie, idp);
    expect(back.searchParams.get("code")).toBeTruthy();
  });

  it("expires unconsented sign-ins after a few minutes but keeps approved ones longer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { client_id } = await registerClient();
    const idle = await startConsent(client_id);
    const { cookie, idp } = await approve(client_id);
    vi.setSystemTime(Date.now() + 181 * 1000);
    expect((await postConsent(idle.id, "approve", idle.cookie)).status).toBe(400);
    expect((await finish(cookie, idp)).searchParams.get("code")).toBeTruthy();
  });

  it("does not count unconsented sign-ins as client activity", async () => {
    await restart({ maxClients: 1 });
    vi.useFakeTimers({ toFake: ["Date"] });
    const { client_id } = await registerClient();
    vi.setSystemTime(Date.now() + 601 * 1000);
    await startConsent(client_id);
    expect((await rawRegister()).status).toBe(201);
  });

  it("keeps one access and one refresh token per grant", async () => {
    await restart({ maxTokens: 2 });
    const { client_id, tokens } = await login();
    let refreshToken = String(tokens.refresh_token);
    for (let n = 0; n < 5; n++) {
      const r = await exchange({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id,
      });
      expect(r.status).toBe(200);
      refreshToken = (await r.json()).refresh_token;
    }
  });

  it("does not burn a code on a request from the wrong client or redirect_uri", async () => {
    const { client_id } = await registerClient();
    const other = await registerClient();
    const back = await signIn(client_id);
    const params = {
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      code_verifier: verifier,
      client_id,
    };
    expect((await exchange({ ...params, client_id: other.client_id })).status).toBe(400);
    expect(
      (await exchange({ ...params, redirect_uri: "http://localhost:9999/other" })).status,
    ).toBe(400);
    expect((await exchange({ ...params, code_verifier: "w".repeat(50) })).status).toBe(400);
    expect((await exchange(params)).status).toBe(200);
  });
});
