/**
 * Rerank client — scores (query, document) pairs using a self-hosted
 * vLLM rerank server (qwen3-vl-rerank).
 *
 * Protocol: Jina-compatible `/rerank` endpoint.
 *   POST /rerank
 *   { model, query, documents: string[] }  →  { results: [{ index, relevance_score }] }
 *
 * For image documents we send a stringified caption prefixed with a tag so
 * the rerank model has at least the textual hint. Full multimodal rerank
 * (sending image bytes) is optional and not universally supported across
 * qwen3-vl-rerank deployments; we fall back to caption text.
 */

import { proxyFetch } from '@/lib/server/proxy-fetch';
import { createLogger } from '@/lib/logger';

const log = createLogger('RAG:Rerank');

function config() {
  const baseUrl = (process.env.RERANK_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.RERANK_API_KEY || '';
  const model = process.env.RERANK_MODEL || 'qwen3-vl-rerank';
  return { baseUrl, apiKey, model };
}

export function isConfigured(): boolean {
  return config().baseUrl.length > 0;
}

export interface RerankInput {
  /** External identifier, returned as-is on the output side. */
  id: string;
  /** Textual content shown to the rerank model. Empty string is allowed. */
  text: string;
}

export interface RerankResult {
  id: string;
  score: number;
}

/**
 * Rerank documents by relevance to the query. Returns results sorted
 * best-first; items with a score below `minScore` are dropped.
 */
export async function rerank(
  query: string,
  docs: RerankInput[],
  opts?: { topK?: number; minScore?: number },
): Promise<RerankResult[]> {
  if (docs.length === 0) return [];
  if (!isConfigured()) {
    log.warn('RERANK_BASE_URL not configured — returning input order');
    return docs.map((d) => ({ id: d.id, score: 0 }));
  }

  const { baseUrl, apiKey, model } = config();
  const url = `${baseUrl}/rerank`;
  const topK = opts?.topK ?? docs.length;

  try {
    const res = await proxyFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        query,
        documents: docs.map((d) => d.text),
        top_n: topK,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Rerank API ${res.status}: ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      results?: Array<{ index: number; relevance_score?: number; score?: number }>;
    };

    const minScore = opts?.minScore ?? -Infinity;
    const out = (json.results ?? [])
      .map((r) => {
        const doc = docs[r.index];
        if (!doc) return null;
        const score = r.relevance_score ?? r.score ?? 0;
        return { id: doc.id, score };
      })
      .filter((r): r is RerankResult => r !== null && r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return out;
  } catch (err) {
    log.warn('Rerank failed, falling back to input order:', err);
    return docs.slice(0, topK).map((d) => ({ id: d.id, score: 0 }));
  }
}
