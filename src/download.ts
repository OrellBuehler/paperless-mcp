import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup, type LookupAddress, type LookupOptions } from "node:dns";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(net, prefix, "ipv6");

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return true;
  return blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}

function privateError(host: string) {
  return new Error(`Refusing to download from ${host}: it is a private or local address`);
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

function publicLookup(hostname: string, options: LookupOptions, callback: LookupCallback) {
  lookup(hostname, { ...options, all: true }, (e, addresses) => {
    if (e) return callback(e, "");
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address)))
      return callback(privateError(hostname), "");
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

export interface DownloadOptions {
  maxBytes: number;
  idleTimeoutMs: number;
  blockPrivate: boolean;
}

export function downloadUrl(
  url: URL,
  { maxBytes, idleTimeoutMs, blockPrivate }: DownloadOptions,
): Promise<{ data: Buffer<ArrayBuffer>; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (blockPrivate && isIP(host) && isPrivateAddress(host)) return reject(privateError(host));
    const tooLarge = () => new Error(`File too large: more than ${maxBytes} bytes`);
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(
      url,
      {
        headers: { "User-Agent": "paperless-mcp", Accept: "*/*" },
        ...(blockPrivate ? { lookup: publicLookup as never } : {}),
        ...(idleTimeoutMs > 0 ? { timeout: idleTimeoutMs } : {}),
      },
      (res) => {
        const fail = (e: Error) => {
          reject(e);
          req.destroy();
        };
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300)
          return fail(new Error(`Failed to download: ${status} ${res.statusMessage ?? ""}`.trim()));
        if (Number(res.headers["content-length"]) > maxBytes) return fail(tooLarge());
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) return fail(tooLarge());
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ data: Buffer.concat(chunks), headers: res.headers }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => {
      reject(new Error(`Download timed out after ${idleTimeoutMs}ms without data`));
      req.destroy();
    });
    req.on("error", reject);
    req.end();
  });
}
