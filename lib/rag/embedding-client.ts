/**
 * Embedding client — wraps the OpenAI-compatible embedding endpoint hosted
 * on the project's vLLM server (qwen3-vl-embedding).
 *
 * Supports both text and image inputs, producing vectors in the same space
 * (qwen3-vl-embedding is a multimodal embedder). Images are sent using the
 * OpenAI multimodal `input: [{ type: 'image_url', image_url: { url: data-url } }]`
 * convention which vLLM accepts.
 */

import { proxyFetch } from '@/lib/server/proxy-fetch';
import { createLogger } from '@/lib/logger';

const log = createLogger('RAG:Embedding');

function config() {
  const baseUrl = (process.env.EMBEDDING_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.EMBEDDING_API_KEY || '';
  const model = process.env.EMBEDDING_MODEL || 'qwen3-vl-embedding';
  const batchSize = Number.parseInt(process.env.EMBEDDING_BATCH_SIZE || '', 10);
  return {
    baseUrl,
    apiKey,
    model,
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 32,
  };
}

export function isConfigured(): boolean {
  return config().baseUrl.length > 0;
}

// ---------------------------------------------------------------------------
// Low-level request
// ---------------------------------------------------------------------------

async function requestEmbeddings(input: unknown[]): Promise<number[][]> {
  const { baseUrl, apiKey, model } = config();
  if (!baseUrl) throw new Error('EMBEDDING_BASE_URL is not configured');

  const url = `${baseUrl}/embeddings`;
  const MAX_ATTEMPTS = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await proxyFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, input }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(`Embedding API ${res.status}: ${body.slice(0, 300)}`);
        // Retry on 5xx / 429, fail fast on 4xx.
        if (res.status >= 500 || res.status === 429) {
          lastError = err;
          await sleep(500 * attempt);
          continue;
        }
        throw err;
      }
      const json = (await res.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const vectors = (json.data ?? []).map((d) => d.embedding ?? []);
      if (vectors.length !== input.length) {
        throw new Error(
          `Embedding API returned ${vectors.length} vectors for ${input.length} inputs`,
        );
      }
      return vectors;
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_ATTEMPTS) {
        log.warn(`Embedding attempt ${attempt} failed: ${lastError.message}`);
        await sleep(500 * attempt);
        continue;
      }
      break;
    }
  }
  throw lastError ?? new Error('Embedding request failed');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Embed a list of text strings. Automatically batches to respect
 * EMBEDDING_BATCH_SIZE. Preserves order.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { batchSize } = config();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const vectors = await requestEmbeddings(slice);
    out.push(...vectors);
  }
  return out;
}

/**
 * Embed a list of images (as buffers). Each image is sent as a data URL
 * via the OpenAI multimodal input format. Batch size stays small because
 * image payloads are much larger than text.
 */
export async function embedImages(
  images: Array<{ buffer: Buffer; ext?: string }>,
): Promise<number[][]> {
  if (images.length === 0) return [];

  // Images are large; use a conservative batch.
  const IMAGE_BATCH = 4;
  const out: number[][] = [];
  for (let i = 0; i < images.length; i += IMAGE_BATCH) {
    const slice = images.slice(i, i + IMAGE_BATCH);
    const inputs = slice.map((img) => [
      {
        type: 'image_url',
        image_url: {
          url: `data:image/${img.ext ?? 'png'};base64,${img.buffer.toString('base64')}`,
        },
      },
    ]);
    const vectors = await requestEmbeddings(inputs);
    out.push(...vectors);
  }
  return out;
}

/**
 * Probe for the vector dimension. Used by `scripts/apply-rag-migration.ts`.
 */
export async function probeDim(): Promise<number> {
  const [v] = await requestEmbeddings(['probe']);
  if (!v || v.length === 0) throw new Error('Embedding probe returned empty vector');
  return v.length;
}
