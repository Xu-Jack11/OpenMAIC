/**
 * Raw-SQL helpers for the `document_chunks` table.
 *
 * The `embedding` and `contentTsv` columns are not modelled by Prisma
 * (they are pgvector / tsvector), so we use `prisma.$queryRaw` and
 * `prisma.$executeRawUnsafe` directly. Input vectors are serialised
 * to the pgvector literal format `'[0.1,0.2,...]'::halfvec`.
 */

import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/server/db';
import { createLogger } from '@/lib/logger';
import type { ChunkType, PreparedChunk } from './types';

const log = createLogger('RAG:PgvectorStore');

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

function toVectorLiteral(vec: number[]): string {
  // pgvector accepts '[1,2,3]' as a text literal. We cast to ::halfvec in SQL.
  // Clip to finite values to avoid SQL errors from NaN/Infinity.
  return '[' + vec.map((v) => (Number.isFinite(v) ? v.toString() : '0')).join(',') + ']';
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

export interface InsertChunk {
  id: string;
  chunkIndex: number;
  chunkType: ChunkType;
  content: string;
  imagePath: string | null;
  metadata: Record<string, unknown> | null;
  embedding: number[];
}

/**
 * Bulk insert chunks for a document. Caller must have already deleted any
 * existing chunks for this document within the same transaction.
 */
export async function insertChunks(
  tx: Prisma.TransactionClient,
  documentId: string,
  chunks: InsertChunk[],
): Promise<void> {
  if (chunks.length === 0) return;

  // Insert one row at a time via prepared statements (safer than constructing
  // multi-VALUES SQL with variable parameter counts, and perfectly fast for
  // our batch sizes ~100-200 rows).
  for (const c of chunks) {
    const vec = toVectorLiteral(c.embedding);
    await tx.$executeRaw`
      INSERT INTO "document_chunks" (
        "id", "documentId", "chunkIndex", "chunkType",
        "content", "imagePath", "embedding", "metadata", "createdAt"
      ) VALUES (
        ${c.id}, ${documentId}, ${c.chunkIndex}, ${c.chunkType},
        ${c.content}, ${c.imagePath}, ${vec}::halfvec,
        ${c.metadata === null ? null : JSON.stringify(c.metadata)}::jsonb,
        NOW()
      )
    `;
  }
  log.debug(`Inserted ${chunks.length} chunks for doc ${documentId}`);
}

/**
 * Remove all chunks for a document. Returns the number of rows deleted.
 */
export async function deleteChunksByDocument(
  tx: Prisma.TransactionClient | typeof prisma,
  documentId: string,
): Promise<number> {
  const rows = await tx.$executeRaw`
    DELETE FROM "document_chunks" WHERE "documentId" = ${documentId}
  `;
  return Number(rows) || 0;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchHit {
  id: string;
  documentId: string;
  documentName: string;
  chunkType: ChunkType;
  content: string | null;
  imagePath: string | null;
  metadata: Record<string, unknown> | null;
  score: number;
}

/**
 * Cosine-similarity vector search scoped to a course (and optionally a
 * subset of document IDs). Returns up to `k` hits ordered by similarity.
 *
 * Score semantics: higher = more similar. We compute `1 - distance` so
 * callers can treat this uniformly.
 */
export async function vectorSearch(
  embedding: number[],
  courseId: string,
  k: number,
  documentIds?: string[],
): Promise<SearchHit[]> {
  const vec = toVectorLiteral(embedding);
  const filterDocs =
    documentIds && documentIds.length > 0
      ? Prisma.sql`AND d."id" IN (${Prisma.join(documentIds)})`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      documentId: string;
      documentName: string;
      chunkType: string;
      content: string | null;
      imagePath: string | null;
      metadata: unknown;
      distance: number;
    }>
  >`
    SELECT c."id", c."documentId", d."name" AS "documentName",
           c."chunkType", c."content", c."imagePath", c."metadata",
           (c."embedding" <=> ${vec}::halfvec) AS "distance"
    FROM "document_chunks" c
    JOIN "documents" d ON d."id" = c."documentId"
    WHERE d."courseId" = ${courseId}
    ${filterDocs}
    ORDER BY c."embedding" <=> ${vec}::halfvec
    LIMIT ${k}
  `;

  return rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    documentName: r.documentName,
    chunkType: r.chunkType as ChunkType,
    content: r.content,
    imagePath: r.imagePath,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    score: 1 - Number(r.distance),
  }));
}

/**
 * Postgres full-text search over the generated `contentTsv` column.
 * Uses `websearch_to_tsquery('simple', ...)` so user queries are accepted
 * as plain strings. Scored with `ts_rank_cd`.
 */
export async function ftsSearch(
  query: string,
  courseId: string,
  k: number,
  documentIds?: string[],
): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const filterDocs =
    documentIds && documentIds.length > 0
      ? Prisma.sql`AND d."id" IN (${Prisma.join(documentIds)})`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      documentId: string;
      documentName: string;
      chunkType: string;
      content: string | null;
      imagePath: string | null;
      metadata: unknown;
      rank: number;
    }>
  >`
    SELECT c."id", c."documentId", d."name" AS "documentName",
           c."chunkType", c."content", c."imagePath", c."metadata",
           ts_rank_cd(c."contentTsv", websearch_to_tsquery('simple', ${query})) AS "rank"
    FROM "document_chunks" c
    JOIN "documents" d ON d."id" = c."documentId"
    WHERE d."courseId" = ${courseId}
      AND c."contentTsv" @@ websearch_to_tsquery('simple', ${query})
    ${filterDocs}
    ORDER BY "rank" DESC
    LIMIT ${k}
  `;

  return rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    documentName: r.documentName,
    chunkType: r.chunkType as ChunkType,
    content: r.content,
    imagePath: r.imagePath,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    score: Number(r.rank),
  }));
}

/**
 * Same as `vectorSearch` but unscoped to a single course — used by
 * `retrieveChunksFromCourses`.
 */
export async function vectorSearchMulti(
  embedding: number[],
  courseIds: string[],
  k: number,
): Promise<SearchHit[]> {
  if (courseIds.length === 0) return [];
  const vec = toVectorLiteral(embedding);
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      documentId: string;
      documentName: string;
      chunkType: string;
      content: string | null;
      imagePath: string | null;
      metadata: unknown;
      distance: number;
    }>
  >`
    SELECT c."id", c."documentId", d."name" AS "documentName",
           c."chunkType", c."content", c."imagePath", c."metadata",
           (c."embedding" <=> ${vec}::halfvec) AS "distance"
    FROM "document_chunks" c
    JOIN "documents" d ON d."id" = c."documentId"
    WHERE d."courseId" IN (${Prisma.join(courseIds)})
    ORDER BY c."embedding" <=> ${vec}::halfvec
    LIMIT ${k}
  `;
  return rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    documentName: r.documentName,
    chunkType: r.chunkType as ChunkType,
    content: r.content,
    imagePath: r.imagePath,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    score: 1 - Number(r.distance),
  }));
}

/**
 * Read full chunk rows by id, preserving the given id order. Used to hydrate
 * rerank candidates after RRF fusion.
 */
export async function getChunksByIds(ids: string[]): Promise<SearchHit[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      documentId: string;
      documentName: string;
      chunkType: string;
      content: string | null;
      imagePath: string | null;
      metadata: unknown;
    }>
  >`
    SELECT c."id", c."documentId", d."name" AS "documentName",
           c."chunkType", c."content", c."imagePath", c."metadata"
    FROM "document_chunks" c
    JOIN "documents" d ON d."id" = c."documentId"
    WHERE c."id" IN (${Prisma.join(ids)})
  `;

  const map = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => map.get(id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .map((r) => ({
      id: r.id,
      documentId: r.documentId,
      documentName: r.documentName,
      chunkType: r.chunkType as ChunkType,
      content: r.content,
      imagePath: r.imagePath,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      score: 0,
    }));
}

// ---------------------------------------------------------------------------
// Helper for converting a PreparedChunk + embedding to InsertChunk
// ---------------------------------------------------------------------------

export function toInsertChunk(
  id: string,
  chunkIndex: number,
  prepared: PreparedChunk,
  imagePath: string | null,
  embedding: number[],
): InsertChunk {
  return {
    id,
    chunkIndex,
    chunkType: prepared.chunkType,
    content: prepared.content,
    imagePath,
    metadata: prepared.metadata ?? null,
    embedding,
  };
}
