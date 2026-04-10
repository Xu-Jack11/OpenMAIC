/**
 * RAG Retriever
 *
 * Retrieves relevant document chunks for a given query using
 * cosine similarity search with pgvector.
 */

import { prisma } from '@/lib/server/db';
import { createLogger } from '@/lib/logger';
import { generateEmbedding, formatEmbeddingForStorage } from './embeddings';
import type { RetrievedChunk, RetrievalOptions } from './types';

const log = createLogger('RAG:Retriever');

// Default retrieval parameters
const DEFAULT_TOP_K = 5;
const DEFAULT_SIMILARITY_THRESHOLD = 0.7;

/**
 * Retrieve relevant document chunks for a query
 */
export async function retrieveChunks(options: RetrievalOptions): Promise<RetrievedChunk[]> {
  const {
    courseId,
    query,
    topK = DEFAULT_TOP_K,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
    documentIds,
  } = options;
  const normalizedDocumentIds = documentIds?.length
    ? [...new Set(documentIds.filter((id) => id.trim().length > 0))]
    : null;

  log.info(`Retrieving chunks for course ${courseId}, query length: ${query.length}`);

  // Generate embedding for the query
  const queryEmbedding = await generateEmbedding(query);
  const embeddingStr = formatEmbeddingForStorage(queryEmbedding);

  // Perform similarity search using pgvector
  // Join with documents table to filter by courseId and get document name
  const results = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      documentId: string;
      documentName: string;
      content: string;
      metadata: string | null;
      similarity: number;
    }>
  >(
    `SELECT
      dc.id,
      dc."documentId",
      d.name as "documentName",
      dc.content,
      dc.metadata::text,
      1 - (dc.embedding <=> $1::vector) as similarity
    FROM document_chunks dc
    JOIN documents d ON dc."documentId" = d.id
    WHERE d."courseId" = $2
      AND dc.embedding IS NOT NULL
      AND 1 - (dc.embedding <=> $1::vector) >= $3
      AND ($5::text[] IS NULL OR dc."documentId" = ANY($5))
    ORDER BY dc.embedding <=> $1::vector
    LIMIT $4`,
    embeddingStr,
    courseId,
    similarityThreshold,
    topK,
    normalizedDocumentIds,
  );

  log.info(`Retrieved ${results.length} relevant chunks`);

  // Parse and return results
  return results.map((row) => ({
    id: row.id,
    documentId: row.documentId,
    documentName: row.documentName,
    content: row.content,
    similarity: row.similarity,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }));
}

/**
 * Retrieve chunks from multiple courses (for cross-course context)
 */
export async function retrieveChunksFromCourses(
  courseIds: string[],
  query: string,
  topK: number = DEFAULT_TOP_K,
  similarityThreshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): Promise<RetrievedChunk[]> {
  if (courseIds.length === 0) {
    return [];
  }

  const queryEmbedding = await generateEmbedding(query);
  const embeddingStr = formatEmbeddingForStorage(queryEmbedding);

  // Build course ID placeholders
  const coursePlaceholders = courseIds.map((_, i) => `$${i + 4}`).join(', ');

  const results = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      documentId: string;
      documentName: string;
      content: string;
      metadata: string | null;
      similarity: number;
    }>
  >(
    `SELECT
      dc.id,
      dc."documentId",
      d.name as "documentName",
      dc.content,
      dc.metadata::text,
      1 - (dc.embedding <=> $1::vector) as similarity
    FROM document_chunks dc
    JOIN documents d ON dc."documentId" = d.id
    WHERE d."courseId" IN (${coursePlaceholders})
      AND dc.embedding IS NOT NULL
      AND 1 - (dc.embedding <=> $1::vector) >= $2
    ORDER BY dc.embedding <=> $1::vector
    LIMIT $3`,
    embeddingStr,
    similarityThreshold,
    topK,
    ...courseIds,
  );

  return results.map((row) => ({
    id: row.id,
    documentId: row.documentId,
    documentName: row.documentName,
    content: row.content,
    similarity: row.similarity,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }));
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
