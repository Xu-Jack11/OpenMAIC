/**
 * Embedding Factory
 *
 * Builds a LangChain `OpenAIEmbeddings` instance from env variables.
 * All providers that expose an OpenAI-compatible `/v1/embeddings` endpoint
 * work here: OpenAI, Qwen/DashScope, GLM (Zhipu), SiliconFlow, Doubao,
 * DeepSeek, Kimi, etc.
 *
 * Config:
 *   EMBEDDING_API_KEY      — bearer token (required)
 *   EMBEDDING_BASE_URL     — OpenAI-compatible endpoint base (default: OpenAI)
 *   EMBEDDING_MODEL        — model id (default: text-embedding-3-small)
 *   EMBEDDING_DIMENSIONS   — vector dimensions (default: 1024, must match
 *                            the vector(N) column in document_chunks)
 *   EMBEDDING_BATCH_SIZE   — max docs per request (default: 96)
 */

import { OpenAIEmbeddings } from '@langchain/openai';
import { createLogger } from '@/lib/logger';

const log = createLogger('RAG:Embedder');

export const DEFAULT_EMBEDDING_DIMENSIONS = 1024;

export interface EmbedderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  batchSize: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getEmbedderConfig(): EmbedderConfig | null {
  const apiKey = process.env.EMBEDDING_API_KEY || '';
  if (!apiKey) return null;

  return {
    apiKey,
    baseUrl: (process.env.EMBEDDING_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    dimensions: parsePositiveInt(process.env.EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_DIMENSIONS),
    batchSize: parsePositiveInt(process.env.EMBEDDING_BATCH_SIZE, 96),
  };
}

export function isConfigured(): boolean {
  return getEmbedderConfig() !== null;
}

/**
 * Construct a LangChain OpenAIEmbeddings instance.
 *
 * Not all OpenAI-compatible providers accept the `dimensions` parameter.
 * We pass it unconditionally because the vector column has a fixed width;
 * providers that ignore it must have their native dimension match
 * EMBEDDING_DIMENSIONS, otherwise insertion will fail at the DB layer.
 */
export function createEmbedder(): OpenAIEmbeddings {
  const config = getEmbedderConfig();
  if (!config) {
    throw new Error(
      'Embedding provider is not configured. Set EMBEDDING_API_KEY (and optionally EMBEDDING_BASE_URL / EMBEDDING_MODEL / EMBEDDING_DIMENSIONS).',
    );
  }

  log.debug(`Embedder: ${config.model} @ ${config.baseUrl} (dim=${config.dimensions})`);

  return new OpenAIEmbeddings({
    apiKey: config.apiKey,
    model: config.model,
    dimensions: config.dimensions,
    batchSize: config.batchSize,
    configuration: {
      baseURL: config.baseUrl,
    },
  });
}
