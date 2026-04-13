/**
 * RAG Retriever (RAGFlow)
 *
 * Retrieves relevant document chunks for a given query
 * using RAGFlow's hybrid search (BM25 + vector similarity).
 */

import { prisma } from '@/lib/server/db';
import { createLogger } from '@/lib/logger';
import * as ragflow from './ragflow-client';
import type { RetrievedChunk, RetrievalOptions } from './types';

const log = createLogger('RAG:Retriever');

// Default retrieval parameters
const DEFAULT_TOP_K = (() => {
  const parsed = Number.parseInt(process.env.RAG_TOP_K || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
})();
const DEFAULT_SIMILARITY_THRESHOLD = (() => {
  const parsed = Number.parseFloat(process.env.RAG_SIMILARITY_THRESHOLD || '');
  return Number.isFinite(parsed) ? parsed : 0.3;
})();

/**
 * Retrieve relevant document chunks for a query via RAGFlow
 */
export async function retrieveChunks(options: RetrievalOptions): Promise<RetrievedChunk[]> {
  const {
    courseId,
    query,
    topK = DEFAULT_TOP_K,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
    documentIds,
  } = options;

  if (!ragflow.isConfigured()) {
    log.warn('RAGFlow is not configured — returning empty results');
    return [];
  }

  log.info(`Retrieving chunks for course ${courseId}, query length: ${query.length}`);

  // Look up the RAGFlow dataset ID for this course
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { ragflowDatasetId: true },
  });

  if (!course?.ragflowDatasetId) {
    log.info(`No RAGFlow dataset for course ${courseId} — no documents indexed`);
    return [];
  }

  // Map OpenMAIC document IDs to RAGFlow document IDs (if filtering)
  let ragflowDocIds: string[] | undefined;
  if (documentIds?.length) {
    const docs = await prisma.document.findMany({
      where: { id: { in: documentIds }, ragflowDocumentId: { not: null } },
      select: { id: true, ragflowDocumentId: true },
    });
    ragflowDocIds = docs.map((d) => d.ragflowDocumentId).filter((id): id is string => id !== null);

    if (ragflowDocIds.length === 0) {
      log.info('None of the filtered documents have been indexed in RAGFlow');
      return [];
    }
  }

  // Call RAGFlow retrieval
  const chunks = await ragflow.retrieve({
    datasetIds: [course.ragflowDatasetId],
    question: query,
    topK,
    similarityThreshold,
    documentIds: ragflowDocIds,
  });

  log.info(`Retrieved ${chunks.length} relevant chunks`);

  // Resolve local document names from RAGFlow document IDs
  // RAGFlow returns documentName as document_keyword, but we prefer our local names
  const ragflowDocIdSet = new Set(chunks.map((c) => c.documentId));
  const localDocs =
    ragflowDocIdSet.size > 0
      ? await prisma.document.findMany({
          where: { ragflowDocumentId: { in: [...ragflowDocIdSet] } },
          select: { id: true, name: true, ragflowDocumentId: true },
        })
      : [];

  const docNameMap = new Map<string, { id: string; name: string }>();
  for (const doc of localDocs) {
    if (doc.ragflowDocumentId) {
      docNameMap.set(doc.ragflowDocumentId, { id: doc.id, name: doc.name });
    }
  }

  return chunks.map((chunk) => {
    const localDoc = docNameMap.get(chunk.documentId);
    return {
      id: chunk.id,
      documentId: localDoc?.id || chunk.documentId,
      documentName: localDoc?.name || chunk.documentName,
      content: chunk.content,
      similarity: chunk.similarity,
    };
  });
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
  if (courseIds.length === 0 || !ragflow.isConfigured()) {
    return [];
  }

  // Look up RAGFlow dataset IDs for all courses
  const courses = await prisma.course.findMany({
    where: { id: { in: courseIds }, ragflowDatasetId: { not: null } },
    select: { ragflowDatasetId: true },
  });

  const datasetIds = courses
    .map((c) => c.ragflowDatasetId)
    .filter((id): id is string => id !== null);

  if (datasetIds.length === 0) {
    return [];
  }

  // RAGFlow supports searching across multiple datasets in one call
  const chunks = await ragflow.retrieve({
    datasetIds,
    question: query,
    topK,
    similarityThreshold,
  });

  // Resolve local document info
  const ragflowDocIdSet = new Set(chunks.map((c) => c.documentId));
  const localDocs =
    ragflowDocIdSet.size > 0
      ? await prisma.document.findMany({
          where: { ragflowDocumentId: { in: [...ragflowDocIdSet] } },
          select: { id: true, name: true, ragflowDocumentId: true },
        })
      : [];

  const docNameMap = new Map<string, { id: string; name: string }>();
  for (const doc of localDocs) {
    if (doc.ragflowDocumentId) {
      docNameMap.set(doc.ragflowDocumentId, { id: doc.id, name: doc.name });
    }
  }

  return chunks.map((chunk) => {
    const localDoc = docNameMap.get(chunk.documentId);
    return {
      id: chunk.id,
      documentId: localDoc?.id || chunk.documentId,
      documentName: localDoc?.name || chunk.documentName,
      content: chunk.content,
      similarity: chunk.similarity,
    };
  });
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
