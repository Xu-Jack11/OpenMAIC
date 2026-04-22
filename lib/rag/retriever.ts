/**
 * RAG Retriever (pgvector)
 *
 * Retrieves relevant document chunks for a query using hybrid search:
 *   - Dense retrieval: pgvector cosine similarity (HNSW index)
 *   - Sparse retrieval: PostgreSQL tsvector + ts_rank_cd (BM25-style)
 *   - Fusion: weighted sum of min-max-normalized scores, α=RAG_VECTOR_WEIGHT
 *
 * Query embedding is computed once per call via the configured provider.
 */

import pgvector from 'pgvector';
import { prisma } from '@/lib/server/db';
import { createLogger } from '@/lib/logger';
import { createEmbedder, isConfigured } from './embedder';
import type { RetrievedChunk, RetrievalOptions } from './types';

const log = createLogger('RAG:Retriever');

const DEFAULT_TOP_K = (() => {
  const n = Number.parseInt(process.env.RAG_TOP_K || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
})();
const DEFAULT_SIMILARITY_THRESHOLD = (() => {
  const n = Number.parseFloat(process.env.RAG_SIMILARITY_THRESHOLD || '');
  return Number.isFinite(n) ? n : 0.3;
})();
const VECTOR_WEIGHT = (() => {
  const n = Number.parseFloat(process.env.RAG_VECTOR_WEIGHT || '');
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.7;
})();
// Oversampling factor: fetch more candidates than topK from each retriever,
// then let hybrid re-rank pick the final topK.
const RECALL_MULTIPLIER = 4;

interface HybridRow {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  vector_score: number | null;
  bm25_score: number | null;
}

function minMaxNormalize(values: Array<number | null>): number[] {
  const defined = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (defined.length === 0) return values.map(() => 0);

  const min = Math.min(...defined);
  const max = Math.max(...defined);
  const span = max - min;

  return values.map((v) => {
    if (v === null || !Number.isFinite(v)) return 0;
    if (span === 0) return 1;
    return (v - min) / span;
  });
}

/**
 * Run hybrid retrieval against one or more courses.
 */
async function hybridSearch(
  courseIds: string[],
  query: string,
  topK: number,
  similarityThreshold: number,
  documentIds?: string[],
): Promise<RetrievedChunk[]> {
  if (courseIds.length === 0) return [];

  const embedder = createEmbedder();
  const queryEmbedding = await embedder.embedQuery(query);
  const embeddingSql = pgvector.toSql(queryEmbedding);

  const candidateLimit = Math.max(topK * RECALL_MULTIPLIER, topK + 5);
  const docFilter = documentIds && documentIds.length > 0 ? documentIds : null;

  // Union of two retrievers, de-duplicated by chunk id.
  //   vector_score = 1 - cosine_distance ∈ [0, 1] (higher = more similar)
  //   bm25_score   = ts_rank_cd result        ∈ [0, ∞) (higher = more relevant)
  const rows = await prisma.$queryRaw<HybridRow[]>`
    WITH vector_hits AS (
      SELECT
        c."id",
        c."documentId",
        c."content",
        c."chunkIndex",
        1 - (c."embedding" <=> ${embeddingSql}::vector) AS vector_score
      FROM "document_chunks" c
      WHERE c."courseId" = ANY(${courseIds}::text[])
        AND c."embedding" IS NOT NULL
        AND (${docFilter}::text[] IS NULL OR c."documentId" = ANY(${docFilter}::text[]))
      ORDER BY c."embedding" <=> ${embeddingSql}::vector
      LIMIT ${candidateLimit}
    ),
    bm25_hits AS (
      SELECT
        c."id",
        c."documentId",
        c."content",
        c."chunkIndex",
        ts_rank_cd(c."tsv", websearch_to_tsquery('simple', ${query})) AS bm25_score
      FROM "document_chunks" c
      WHERE c."courseId" = ANY(${courseIds}::text[])
        AND (${docFilter}::text[] IS NULL OR c."documentId" = ANY(${docFilter}::text[]))
        AND c."tsv" @@ websearch_to_tsquery('simple', ${query})
      ORDER BY bm25_score DESC
      LIMIT ${candidateLimit}
    ),
    merged AS (
      SELECT v."id", v."documentId", v."content", v."chunkIndex",
             v.vector_score, NULL::real AS bm25_score
      FROM vector_hits v
      UNION
      SELECT b."id", b."documentId", b."content", b."chunkIndex",
             NULL::double precision AS vector_score, b.bm25_score
      FROM bm25_hits b
    )
    SELECT
      "id",
      "documentId",
      "content",
      "chunkIndex",
      MAX(vector_score) AS vector_score,
      MAX(bm25_score)   AS bm25_score
    FROM merged
    GROUP BY "id", "documentId", "content", "chunkIndex"
  `;

  if (rows.length === 0) {
    log.info('Hybrid search returned no candidates');
    return [];
  }

  // Fuse scores
  const vectorNorm = minMaxNormalize(rows.map((r) => r.vector_score));
  const bm25Norm = minMaxNormalize(rows.map((r) => r.bm25_score));

  const scored = rows.map((row, idx) => {
    const score = VECTOR_WEIGHT * vectorNorm[idx] + (1 - VECTOR_WEIGHT) * bm25Norm[idx];
    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Apply threshold and cap
  const top = scored
    .filter(({ score }) => score >= similarityThreshold)
    .slice(0, topK)
    .map(({ row, score }) => ({ row, score }));

  if (top.length === 0) {
    log.info(
      `Hybrid search had ${rows.length} candidates but none passed threshold ${similarityThreshold}`,
    );
    return [];
  }

  // Resolve local document names
  const docIds = Array.from(new Set(top.map((t) => t.row.documentId)));
  const docs = await prisma.document.findMany({
    where: { id: { in: docIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(docs.map((d) => [d.id, d.name]));

  return top.map(({ row, score }) => ({
    id: row.id,
    documentId: row.documentId,
    documentName: nameMap.get(row.documentId) || '',
    content: row.content,
    similarity: score,
  }));
}

/**
 * Retrieve relevant document chunks for a query.
 */
export async function retrieveChunks(options: RetrievalOptions): Promise<RetrievedChunk[]> {
  const {
    courseId,
    query,
    topK = DEFAULT_TOP_K,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
    documentIds,
  } = options;

  if (!isConfigured()) {
    log.warn('Embedding provider is not configured — returning empty results');
    return [];
  }

  log.info(`Retrieving chunks for course ${courseId}, query length: ${query.length}`);

  const chunks = await hybridSearch([courseId], query, topK, similarityThreshold, documentIds);
  log.info(`Retrieved ${chunks.length} chunks`);
  return chunks;
}

/**
 * Retrieve chunks from multiple courses (cross-course context)
 */
export async function retrieveChunksFromCourses(
  courseIds: string[],
  query: string,
  topK: number = DEFAULT_TOP_K,
  similarityThreshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): Promise<RetrievedChunk[]> {
  if (courseIds.length === 0 || !isConfigured()) return [];
  return hybridSearch(courseIds, query, topK, similarityThreshold);
}

/**
 * Get indexing status summary for a course
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

  const result = {
    total: 0,
    indexed: 0,
    pending: 0,
    indexing: 0,
    failed: 0,
  };

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
