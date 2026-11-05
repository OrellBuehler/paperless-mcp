import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StateStore {
  path: string;
  read(): unknown;
  write(state: unknown): void;
}

const VERSION = 1;
const SALT = `paperless-mcp/oauth-state/v${VERSION}`;
const AAD = Buffer.from(`paperless-mcp oauth-state v${VERSION}`);
const MIN_SECRET_LENGTH = 16;

function deriveStateKey(secret: string): Buffer {
  return scryptSync(secret, SALT, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function createStateStore(dir: string, secret: string): StateStore {
  if (secret.length < MIN_SECRET_LENGTH)
    throw new Error(`MCP_OAUTH_STATE_KEY must be at least ${MIN_SECRET_LENGTH} characters`);
  const key = deriveStateKey(secret);
  const path = join(dir, "oauth-state.json");
  let secured = false;

  function secureDir() {
    if (secured) return;
    secured = true;
    try {
      if (statSync(dir).mode & 0o077) chmodSync(dir, 0o700);
    } catch (e) {
      console.error(
        `Warning: could not restrict ${dir} to mode 0700: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  function syncDir() {
    let fd: number;
    try {
      fd = openSync(dir, "r");
    } catch {
      return;
    }
    try {
      fsyncSync(fd);
    } catch {
      return;
    } finally {
      closeSync(fd);
    }
  }

  function decrypt(raw: string): unknown {
    const file = JSON.parse(raw);
    if (file?.v !== VERSION) throw new Error(`unsupported version ${file?.v}`);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(file.iv, "base64"), {
      authTagLength: 16,
    });
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(file.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(file.data, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plain.toString("utf8"));
  }

  function read(): unknown {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    try {
      return decrypt(raw);
    } catch {
      const aside = `${path}.bak-${Date.now()}`;
      renameSync(path, aside);
      console.error(
        `Warning: cannot read ${path} (wrong MCP_OAUTH_STATE_KEY or corrupt file); moved it to ${aside} and starting with empty OAuth state`,
      );
      return null;
    }
  }

  function write(state: unknown) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    secureDir();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    cipher.setAAD(AAD);
    const data = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
    const body = JSON.stringify({
      v: VERSION,
      alg: "aes-256-gcm",
      kdf: "scrypt",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    });
    const tmp = `${path}.tmp`;
    rmSync(tmp, { force: true });
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeSync(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
    syncDir();
  }

  return { path, read, write };
}

export function stateStoreFromEnv(env: NodeJS.ProcessEnv = process.env): StateStore | null {
  const secret = env.MCP_OAUTH_STATE_KEY || "";
  if (!secret) {
    console.error(
      "OAuth state is kept in memory only; set MCP_OAUTH_STATE_KEY to keep client registrations and sign-ins across restarts",
    );
    return null;
  }
  return createStateStore(env.PAPERLESS_MCP_DATA || join(homedir(), ".paperless-mcp"), secret);
}
