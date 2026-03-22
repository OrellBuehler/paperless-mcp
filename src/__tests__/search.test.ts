import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

describe("contentHash", () => {
  it("returns a 16-character hex string", () => {
    const hash = contentHash("hello world");
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns consistent results for same input", () => {
    const hash1 = contentHash("test document content");
    const hash2 = contentHash("test document content");
    expect(hash1).toBe(hash2);
  });

  it("returns different hashes for different input", () => {
    const hash1 = contentHash("document A");
    const hash2 = contentHash("document B");
    expect(hash1).not.toBe(hash2);
  });

  it("handles empty string", () => {
    const hash = contentHash("");
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("handles unicode content", () => {
    const hash = contentHash("Rechnung für Müller GmbH — €1.234,56");
    expect(hash).toHaveLength(16);
  });
});
