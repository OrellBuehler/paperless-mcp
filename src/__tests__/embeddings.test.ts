import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.stubEnv("PAPERLESS_URL", "http://localhost:8000");
vi.stubEnv("PAPERLESS_TOKEN", "test-token");

describe("embeddings with openai provider", () => {
  beforeEach(() => {
    vi.stubEnv("EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("EMBEDDING_MODEL", "text-embedding-3-small");
    vi.stubEnv("EMBEDDING_DIMENSIONS", "1536");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns provider info for openai", async () => {
    const { getProviderInfo } = await import("../embeddings.js");
    const info = getProviderInfo();
    expect(info.provider).toBe("openai");
    expect(info.model).toBe("text-embedding-3-small");
    expect(info.dimensions).toBe(1536);
  });

  it("returns embedding dimensions", async () => {
    const { getEmbeddingDimensions } = await import("../embeddings.js");
    expect(getEmbeddingDimensions()).toBe(1536);
  });

  it("returns empty array for empty input", async () => {
    const { embed } = await import("../embeddings.js");
    const result = await embed([]);
    expect(result).toEqual([]);
  });

  it("calls openai embedding API correctly", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { index: 0, embedding: [0.1, 0.2, 0.3] },
            { index: 1, embedding: [0.4, 0.5, 0.6] },
          ],
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { embed } = await import("../embeddings.js");
    const result = await embed(["hello", "world"]);

    expect(result).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test-key",
        }),
      }),
    );
  });

  it("sorts openai results by index", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { index: 1, embedding: [0.4, 0.5] },
            { index: 0, embedding: [0.1, 0.2] },
          ],
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { embed } = await import("../embeddings.js");
    const result = await embed(["first", "second"]);

    expect(result).toEqual([
      [0.1, 0.2],
      [0.4, 0.5],
    ]);
  });

  it("throws on openai API error", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Rate limited"),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { embed } = await import("../embeddings.js");
    await expect(embed(["test"])).rejects.toThrow("OpenAI embedding error: 429");
  });

  it("embedSingle wraps embed for single text", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { embedSingle } = await import("../embeddings.js");
    const result = await embedSingle("hello");
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });
});

describe("embeddings with openai missing key", () => {
  beforeEach(() => {
    vi.stubEnv("EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when OPENAI_API_KEY is missing", async () => {
    const { embed } = await import("../embeddings.js");
    await expect(embed(["test"])).rejects.toThrow("OPENAI_API_KEY is required");
  });
});

describe("embeddings with ollama provider", () => {
  beforeEach(() => {
    vi.stubEnv("EMBEDDING_PROVIDER", "ollama");
    vi.stubEnv("EMBEDDING_MODEL", "nomic-embed-text");
    vi.stubEnv("EMBEDDING_DIMENSIONS", "768");
    vi.stubEnv("OLLAMA_URL", "http://localhost:11434");
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns provider info for ollama", async () => {
    const { getProviderInfo } = await import("../embeddings.js");
    const info = getProviderInfo();
    expect(info.provider).toBe("ollama");
    expect(info.model).toBe("nomic-embed-text");
    expect(info.dimensions).toBe(768);
  });

  it("calls ollama embedding API correctly", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          embeddings: [
            [0.1, 0.2],
            [0.3, 0.4],
          ],
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { embed } = await import("../embeddings.js");
    const result = await embed(["hello", "world"]);

    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws on ollama API error", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal error"),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { embed } = await import("../embeddings.js");
    await expect(embed(["test"])).rejects.toThrow("Ollama embedding error: 500");
  });

  it("strips trailing slashes from OLLAMA_URL", async () => {
    vi.stubEnv("OLLAMA_URL", "http://localhost:11434///");
    vi.resetModules();

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ embeddings: [[0.1]] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { embed } = await import("../embeddings.js");
    await embed(["test"]);

    expect(mockFetch.mock.calls[0][0]).toBe("http://localhost:11434/api/embed");
  });
});
