/**
 * RAG Retriever — self-hosted pgvector backend.
 *
 * Pipeline per `retrieveChunks` call:
 *   1. (optional) `rewriteQuery` — local LLM produces HyDE + 3 rewrites
 *   2. `embedTexts([original, ...rewrites, hyde])` — one batched call
 *   3. Parallel paths:
 *        a. vector search for each embedding
 *        b. full-text search on original query (websearch_to_tsquery)
 *   4. RRF fusion (k=60) — union the candidate pool
 *   5. Rerank top-N via qwen3-vl-rerank
 *   6. Return `topK` best hits as `RetrievedChunk[]`
 */

import { prisma } from '@/lib/server/db';
import { createLogger } from '@/lib/logger';
import { embedTexts, isConfigured as isEmbedConfigured } from './embedding-client';
import { rerank } from './rerank-client';
import { rewriteQuery } from './query-rewrite';
import { rrfFuseIds } from './rrf';
import {
  vectorSearch,
  vectorSearchMulti,
  ftsSearch,
  getChunksByIds,
  type SearchHit,
} from './pgvector-store';
import type { RetrievedChunk, RetrievalOptions } from './types';

const log = createLogger('RAG:Retriever');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_TOP_K = parseIntEnv('RAG_TOP_K', 5);
const DEFAULT_CANDIDATE_K = parseIntEnv('RAG_CANDIDATE_K', 20);

function parseIntEnv(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function readFlag(envVar: string, fallback: boolean): boolean {
  const v = process.env[envVar];
  if (v === undefined) return fallback;
  return !(v === 'false' || v === '0' || v.toLowerCase() === 'off');
}

// ---------------------------------------------------------------------------
// Main entrypoints
// ---------------------------------------------------------------------------

export async function retrieveChunks(options: RetrievalOptions): Promise<RetrievedChunk[]> {
  const { courseId, query, topK = DEFAULT_TOP_K, documentIds, enableRewrite } = options;

  if (!isEmbedConfigured()) {
    log.warn('EMBEDDING_BASE_URL not configured — returning empty results');
    return [];
  }

  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  // 1. Query rewriting
  const { rewrites, hyde } = await rewriteQuery(trimmedQuery, {
    enableRewrite,
  });

  // 2. Embed everything in one batched call
  const embedInputs = [trimmedQuery, ...rewrites];
  if (hyde) embedInputs.push(hyde);

  let embeddings: number[][];
  try {
    embeddings = await embedTexts(embedInputs);
  } catch (err) {
    log.warn(`Embedding query failed: ${(err as Error).message}`);
    return [];
  }

  const candidateK = DEFAULT_CANDIDATE_K;

  // 3. Run all retrieval paths in parallel
  const vectorPromises = embeddings.map((v) => vectorSearch(v, courseId, candidateK, documentIds));
  const ftsPromise = readFlag('RAG_ENABLE_FTS', true)
    ? ftsSearch(trimmedQuery, courseId, candidateK, documentIds)
    : Promise.resolve<SearchHit[]>([]);

  const [vectorHitsArr, ftsHits] = await Promise.all([Promise.all(vectorPromises), ftsPromise]);

  // 4. RRF fusion
  const idLists: string[][] = [
    ...vectorHitsArr.map((hits) => hits.map((h) => h.id)),
    ftsHits.map((h) => h.id),
  ];
  const fused = rrfFuseIds(idLists);

  if (fused.length === 0) {
    log.info('No candidates found after fusion');
    return [];
  }

  // 5. Hydrate full chunk rows for the rerank stage
  const candidateIds = fused.slice(0, candidateK).map((f) => f.id);
  const hydrated = await getChunksByIds(candidateIds);

  // Build rerank payload: text chunks use content, image chunks use caption
  // (possibly empty) prefixed with a marker to hint the reranker.
  const rerankInputs = hydrated.map((h) => ({
    id: h.id,
    text:
      h.chunkType === 'image' ? `[图: ${h.content?.trim() || h.documentName}]` : (h.content ?? ''),
  }));

  const rerankResults = await rerank(trimmedQuery, rerankInputs, { topK });

  // 6. Assemble final output in rerank order
  const byId = new Map(hydrated.map((h) => [h.id, h]));
  const out: RetrievedChunk[] = [];
  for (const r of rerankResults) {
    const hit = byId.get(r.id);
    if (!hit) continue;
    out.push({
      id: hit.id,
      documentId: hit.documentId,
      documentName: hit.documentName,
      chunkType: hit.chunkType,
      content: hit.content ?? '',
      imagePath: hit.imagePath ?? undefined,
      similarity: r.score,
      metadata: hit.metadata ?? undefined,
    });
    if (out.length >= topK) break;
  }

  log.info(
    `Retrieved ${out.length} chunks (candidates=${hydrated.length}, rewrites=${rewrites.length}, hyde=${hyde ? 1 : 0})`,
  );
  return out;
}

/**
 * Retrieve chunks from multiple courses. Same shape as single-course retrieval
 * but without query rewriting (to keep cross-course lookups cheap). FTS
 * isn't applied here either — multi-course is typically used for broader,
 * exploratory context.
 */
export async function retrieveChunksFromCourses(
  courseIds: string[],
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<RetrievedChunk[]> {
  if (!courseIds.length) return [];
  if (!isEmbedConfigured()) return [];

  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const [embedding] = await embedTexts([trimmedQuery]);
  if (!embedding) return [];

  const candidateK = Math.max(topK * 4, DEFAULT_CANDIDATE_K);
  const hits = await vectorSearchMulti(embedding, courseIds, candidateK);
  if (hits.length === 0) return [];

  const rerankInputs = hits.map((h) => ({
    id: h.id,
    text:
      h.chunkType === 'image' ? `[图: ${h.content?.trim() || h.documentName}]` : (h.content ?? ''),
  }));

  const rerankResults = await rerank(trimmedQuery, rerankInputs, { topK });
  const byId = new Map(hits.map((h) => [h.id, h]));
  const out: RetrievedChunk[] = [];
  for (const r of rerankResults) {
    const hit = byId.get(r.id);
    if (!hit) continue;
    out.push({
      id: hit.id,
      documentId: hit.documentId,
      documentName: hit.documentName,
      chunkType: hit.chunkType,
      content: hit.content ?? '',
      imagePath: hit.imagePath ?? undefined,
      similarity: r.score,
      metadata: hit.metadata ?? undefined,
    });
  }
  return out;
}

/**
 * Get indexing status summary for a course (preserved from original API).
 */
export async function getCourseIndexingStatus(courseId: string): Promise<{
  total: number;
  indexed: number;
  pending: number;
  indexing: number;
  failed: number;
}> {
  const counts = await prisma.document.groupBy({
    by: ['indexStatus'],
    where: { courseId },
    _count: true,
  });

  const result = { total: 0, indexed: 0, pending: 0, indexing: 0, failed: 0 };
  for (const row of counts) {
    const count = row._count;
    result.total += count;
    switch (row.indexStatus) {
      case 'indexed':
        result.indexed = count;
        break;
      case 'pending':
        result.pending = count;
        break;
      case 'indexing':
        result.indexing = count;
        break;
      case 'failed':
        result.failed = count;
        break;
    }
  }
  return result;
}
