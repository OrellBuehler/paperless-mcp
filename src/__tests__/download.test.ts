import { describe, it, expect, afterEach } from "vitest";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { downloadUrl, isPrivateAddress } from "../download.js";

const options = { maxBytes: 1000, idleTimeoutMs: 1000, blockPrivate: false };
let server: Server | undefined;

async function serve(handler: RequestListener) {
  server = createServer(handler);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return (host = "127.0.0.1") =>
    new URL(`http://${host}:${(server!.address() as AddressInfo).port}/file.pdf`);
}

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
});

describe("isPrivateAddress", () => {
  it("flags loopback, private, link-local and mapped addresses", () => {
    for (const a of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fe80::1",
      "fd00::1",
      "::ffff:10.1.2.3",
      "::ffff:7f00:1",
      "not-an-ip",
    ])
      expect(isPrivateAddress(a), a).toBe(true);
  });

  it("allows public addresses", () => {
    for (const a of ["1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"])
      expect(isPrivateAddress(a), a).toBe(false);
  });
});

describe("downloadUrl", () => {
  it("returns the body and headers", async () => {
    const url = await serve((_req, res) => {
      res.setHeader("Content-Type", "application/pdf");
      res.end("data");
    });
    const { data, headers } = await downloadUrl(url(), options);
    expect(data.toString()).toBe("data");
    expect(headers["content-type"]).toBe("application/pdf");
  });

  it("refuses private literals and names that resolve to them when blocking", async () => {
    let hits = 0;
    const url = await serve((_req, res) => {
      hits++;
      res.end("data");
    });
    const blocking = { ...options, blockPrivate: true };
    await expect(downloadUrl(url(), blocking)).rejects.toThrow(/private or local/);
    await expect(downloadUrl(url("localhost"), blocking)).rejects.toThrow(/private or local/);
    await expect(downloadUrl(new URL("http://[::ffff:127.0.0.1]/x"), blocking)).rejects.toThrow(
      /private or local/,
    );
    await expect(downloadUrl(new URL("http://2130706433/x"), blocking)).rejects.toThrow(
      /private or local/,
    );
    expect(hits).toBe(0);
  });

  it("does not follow redirects", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(302, { Location: "http://169.254.169.254/" }).end();
    });
    await expect(downloadUrl(url(), options)).rejects.toThrow(/Failed to download: 302/);
  });

  it("enforces the size cap on a declared length", async () => {
    const url = await serve((_req, res) => res.end("x".repeat(2000)));
    await expect(downloadUrl(url(), options)).rejects.toThrow(/File too large/);
  });

  it("enforces the size cap while streaming a chunked body", async () => {
    const url = await serve((_req, res) => {
      res.write("x".repeat(600));
      setTimeout(() => res.end("x".repeat(600)), 10);
    });
    await expect(downloadUrl(url(), options)).rejects.toThrow(/File too large/);
  });

  it("times out when the server stops sending", async () => {
    const url = await serve((_req, res) => {
      res.write("x");
    });
    await expect(downloadUrl(url(), { ...options, idleTimeoutMs: 50 })).rejects.toThrow(
      /timed out after 50ms/,
    );
  });
});
