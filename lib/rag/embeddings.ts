/**
 * Embedding Provider Abstraction
 *
 * Provides a unified interface for generating text embeddings.
 * Supports OpenAI embeddings (default) with extensibility for local models.
 */

import { createLogger } from '@/lib/logger';
import type { EmbeddingProviderConfig } from './types';

const log = createLogger('RAG:Embeddings');

// Default configuration
const DEFAULT_CONFIG: EmbeddingProviderConfig = {
  provider: 'openai',
  model: 'text-embedding-3-small',
  dimensions: 1536,
};

/**
 * Get embedding provider configuration from environment
 */
export function getEmbeddingConfig(): EmbeddingProviderConfig {
  const provider = (process.env.EMBEDDING_PROVIDER as 'openai' | 'local') || 'openai';

  if (provider === 'openai') {
    return {
      provider: 'openai',
      model: process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_CONFIG.model,
      // Prefer dedicated embedding API key, fallback to general OpenAI API key
      apiKey: process.env.OPENAI_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY,
      // Prefer dedicated embedding base URL, fallback to general OpenAI base URL
      baseUrl: process.env.OPENAI_EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL,
      dimensions: 1536,
    };
  }

  // Local provider (future extension)
  return {
    provider: 'local',
    baseUrl: process.env.LOCAL_EMBEDDING_URL,
    dimensions: parseInt(process.env.LOCAL_EMBEDDING_DIMENSIONS || '1536', 10),
  };
}

/**
 * Generate embeddings for a single text
 */
export async function generateEmbedding(
  text: string,
  config?: EmbeddingProviderConfig,
): Promise<number[]> {
  const cfg = config || getEmbeddingConfig();

  if (cfg.provider === 'openai') {
    return generateOpenAIEmbedding(text, cfg);
  }

  throw new Error(`Embedding provider "${cfg.provider}" not implemented`);
}

/**
 * Generate embeddings for multiple texts (batch)
 */
export async function generateEmbeddings(
  texts: string[],
  config?: EmbeddingProviderConfig,
): Promise<number[][]> {
  const cfg = config || getEmbeddingConfig();

  if (texts.length === 0) {
    return [];
  }

  if (cfg.provider === 'openai') {
    return generateOpenAIEmbeddings(texts, cfg);
  }

  throw new Error(`Embedding provider "${cfg.provider}" not implemented`);
}

/**
 * Generate embedding using OpenAI API
 */
async function generateOpenAIEmbedding(
  text: string,
  config: EmbeddingProviderConfig,
): Promise<number[]> {
  const embeddings = await generateOpenAIEmbeddings([text], config);
  return embeddings[0];
}

/**
 * Generate embeddings using OpenAI API (batch)
 */
async function generateOpenAIEmbeddings(
  texts: string[],
  config: EmbeddingProviderConfig,
): Promise<number[][]> {
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error('OpenAI API key not configured for embeddings');
  }

  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const model = config.model || 'text-embedding-3-small';

  log.info(`Generating embeddings for ${texts.length} texts using ${model}`);

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: texts,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error(`OpenAI embedding API error: ${response.status} ${errorText}`);
    throw new Error(`OpenAI embedding API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  // Sort by index to maintain order
  const sorted = data.data.sort((a, b) => a.index - b.index);
  return sorted.map((item) => item.embedding);
}

/**
 * Format embedding array for pgvector storage
 */
export function formatEmbeddingForStorage(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
