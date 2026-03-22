export type EmbeddingProvider = "openai" | "ollama";

const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER || "openai") as EmbeddingProvider;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || (EMBEDDING_PROVIDER === "openai" ? "text-embedding-3-small" : "nomic-embed-text");
const EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || (EMBEDDING_PROVIDER === "openai" ? "1536" : "768"), 10);
if (isNaN(EMBEDDING_DIMENSIONS) || EMBEDDING_DIMENSIONS <= 0) {
  console.error("EMBEDDING_DIMENSIONS must be a positive integer");
  process.exit(1);
}
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "");

export function getEmbeddingDimensions(): number {
  return EMBEDDING_DIMENSIONS;
}

export function getProviderInfo() {
  return { provider: EMBEDDING_PROVIDER, model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS };
}

async function embedOpenAI(texts: string[]): Promise<number[][]> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required when using OpenAI embeddings");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI embedding error: ${res.status} ${body}`);
  }
  const data = await res.json() as { data: { embedding: number[]; index: number }[] };
  return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}

async function embedOllama(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama embedding error: ${res.status} ${body}`);
    }
    const data = await res.json() as { embeddings: number[][] };
    results.push(data.embeddings[0]);
  }
  return results;
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (EMBEDDING_PROVIDER === "ollama") return embedOllama(texts);
  return embedOpenAI(texts);
}

export async function embedSingle(text: string): Promise<number[]> {
  const [result] = await embed([text]);
  return result;
}
