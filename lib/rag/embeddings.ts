/**
 * Embedding Provider Abstraction
 *
 * Provides a unified interface for generating text embeddings.
 * Supports OpenAI embeddings (default) with extensibility for local models.
 */

import { createLogger } from '@/lib/logger';
import type { EmbeddingProviderConfig } from './types';

const log = createLogger('RAG:Embeddings');

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: unknown }).code;
    const parts = [error.message];
    if (typeof code === 'string' && code.length > 0) parts.push(code);
    if (cause.message && cause.message !== error.message) parts.push(cause.message);
    return parts.join(' — ');
  }

  return error.message;
}

function isRetryableNetworkError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /fetch failed|network|timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR/i.test(
    message,
  );
}

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const EMBEDDING_REQUEST_TIMEOUT_MS = parsePositiveInt(
  process.env.OPENAI_EMBEDDING_TIMEOUT_MS,
  120_000,
);
const EMBEDDING_REQUEST_RETRIES = parsePositiveInt(process.env.OPENAI_EMBEDDING_RETRIES, 2);
const EMBEDDING_RETRY_BASE_DELAY_MS = parsePositiveInt(
  process.env.OPENAI_EMBEDDING_RETRY_DELAY_MS,
  1_000,
);

// Default configuration
const DEFAULT_CONFIG: EmbeddingProviderConfig = {
  provider: 'openai',
  model: 'text-embedding-3-small',
  dimensions: 1024,
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
      dimensions: parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS || '1024', 10),
    };
  }

  // Local provider (future extension)
  return {
    provider: 'local',
    baseUrl: process.env.LOCAL_EMBEDDING_URL,
    dimensions: parseInt(process.env.LOCAL_EMBEDDING_DIMENSIONS || '1024', 10),
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

// Max characters per text input — keeps each text under typical embedding model limits.
// 8192 tokens × ~4 chars/token = 32768, use a conservative limit.
const MAX_INPUT_CHARS = 30000;

/**
 * Generate embeddings using OpenAI API (batch)
 */
async function generateOpenAIEmbeddings(
  texts: string[],
  config: EmbeddingProviderConfig,
): Promise<number[][]> {
  const apiKey = config.apiKey || 'dummy';
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const model = config.model || 'text-embedding-3-small';

  // Truncate any text that exceeds the embedding model's context limit
  const sanitized = texts.map((t) => {
    if (t.length > MAX_INPUT_CHARS) {
      log.warn(`Truncating text from ${t.length} to ${MAX_INPUT_CHARS} chars for embedding`);
      return t.slice(0, MAX_INPUT_CHARS);
    }
    return t;
  });

  log.info(`Generating embeddings for ${sanitized.length} texts using ${model}`);
  const maxAttempts = EMBEDDING_REQUEST_RETRIES + 1;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: sanitized,
        }),
        signal: AbortSignal.timeout(EMBEDDING_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const briefErrorText = errorText.length > 400 ? `${errorText.slice(0, 400)}...` : errorText;
        const errorMessage = `Embedding API error: ${response.status} ${briefErrorText}`;

        if (attempt < maxAttempts && RETRYABLE_STATUSES.has(response.status)) {
          const delay = EMBEDDING_RETRY_BASE_DELAY_MS * attempt;
          log.warn(
            `${errorMessage}. Retrying (${attempt}/${maxAttempts}) after ${delay}ms...`,
          );
          await sleep(delay);
          continue;
        }

        throw new Error(errorMessage);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      if (!Array.isArray(data.data)) {
        throw new Error('Embedding API returned malformed response: missing data array');
      }

      if (data.data.length !== sanitized.length) {
        throw new Error(
          `Embedding API returned ${data.data.length} vectors, expected ${sanitized.length}`,
        );
      }

      // Sort by index to maintain order
      const sorted = data.data.sort((a, b) => a.index - b.index);
      return sorted.map((item) => item.embedding);
    } catch (error) {
      const message = getErrorMessage(error);
      const wrappedError = new Error(message);
      lastError = wrappedError;

      if (attempt < maxAttempts && isRetryableNetworkError(error)) {
        const delay = EMBEDDING_RETRY_BASE_DELAY_MS * attempt;
        log.warn(
          `Embedding request failed: ${message}. Retrying (${attempt}/${maxAttempts}) after ${delay}ms...`,
        );
        await sleep(delay);
        continue;
      }

      break;
    }
  }

  throw lastError || new Error('Embedding request failed');
}

/**
 * Format embedding array for pgvector storage
 */
export function formatEmbeddingForStorage(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
