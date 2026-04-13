/**
 * Document Indexer (RAGFlow)
 *
 * Processes uploaded documents for RAG retrieval via RAGFlow:
 * 1. Ensures a RAGFlow dataset exists for the course
 * 2. Uploads the document file to RAGFlow
 * 3. Triggers RAGFlow parsing (chunking + embedding)
 * 4. Polls for completion and updates local status
 */

import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/server/db';
import { createLogger } from '@/lib/logger';
import * as ragflow from './ragflow-client';
import type { IndexingResult } from './types';

const log = createLogger('RAG:Indexer');

// Polling configuration
const POLL_INITIAL_INTERVAL_MS = 2000;
const POLL_MAX_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.RAGFLOW_PARSE_TIMEOUT_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000; // 5 min default
})();

// Stale indexing threshold — auto-reset documents stuck in 'indexing' for this long
const STALE_INDEXING_MS = 10 * 60 * 1000; // 10 minutes

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure a RAGFlow dataset exists for the given course.
 * Creates one if missing, with race-condition protection.
 */
async function ensureDataset(courseId: string, courseName: string): Promise<string> {
  // Check current value
  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });

  if (course.ragflowDatasetId) {
    return course.ragflowDatasetId;
  }

  // Create dataset in RAGFlow
  const datasetId = await ragflow.createDataset(courseName, {
    chunkMethod: process.env.RAGFLOW_CHUNK_METHOD,
  });

  // Race-safe update: only set if still null (another concurrent upload may have beaten us)
  const updated = await prisma.course.updateMany({
    where: { id: courseId, ragflowDatasetId: null },
    data: { ragflowDatasetId: datasetId },
  });

  if (updated.count === 0) {
    // Another process already created a dataset — use theirs, clean up ours
    const existing = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    log.warn(
      `Race: another process created dataset for course ${courseId}. Using ${existing.ragflowDatasetId}, cleaning up ${datasetId}`,
    );
    await ragflow.deleteDataset(datasetId).catch(() => {});
    return existing.ragflowDatasetId!;
  }

  return datasetId;
}

/**
 * Poll RAGFlow until a document's parsing is complete or timed out.
 * Returns the final run status.
 */
async function pollParsingStatus(
  datasetId: string,
  ragflowDocId: string,
): Promise<'DONE' | 'FAIL'> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let interval = POLL_INITIAL_INTERVAL_MS;

  while (Date.now() < deadline) {
    await sleep(interval);

    const status = await ragflow.getDocumentStatus(datasetId, ragflowDocId);

    if (status.run === 'DONE') return 'DONE';
    if (status.run === 'FAIL') return 'FAIL';
    // CANCEL is treated as failure
    if (status.run === 'CANCEL') return 'FAIL';

    // Back off gradually
    interval = Math.min(interval + 500, POLL_MAX_INTERVAL_MS);
  }

  throw new Error(`Parsing timed out after ${POLL_TIMEOUT_MS / 1000}s`);
}

/**
 * Index a document for RAG retrieval via RAGFlow
 */
export async function indexDocument(documentId: string): Promise<IndexingResult> {
  log.info(`Starting indexing for document: ${documentId}`);

  // Check RAGFlow availability
  if (!ragflow.isConfigured()) {
    log.warn('RAGFlow is not configured — skipping indexing');
    await prisma.document.update({
      where: { id: documentId },
      data: { indexStatus: 'failed', indexError: 'RAGFlow is not configured' },
    });
    return { documentId, status: 'failed', chunksCreated: 0, error: 'RAGFlow is not configured' };
  }

  try {
    // Fetch document with course info
    const document = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { course: true },
    });

    // Guard: prevent concurrent indexing
    if (document.indexStatus === 'indexing') {
      // Check for stale indexing (poll loop may have died)
      const age = Date.now() - document.createdAt.getTime();
      if (age < STALE_INDEXING_MS) {
        log.warn(`Document ${documentId} is already being indexed — skipping`);
        return { documentId, status: 'indexing', chunksCreated: 0 };
      }
      log.warn(`Document ${documentId} has been stuck in 'indexing' for >10min — resetting`);
    }

    // Set status to indexing
    await prisma.document.update({
      where: { id: documentId },
      data: { indexStatus: 'indexing', indexError: null },
    });

    // 1. Ensure RAGFlow dataset exists for the course
    const datasetId = await ensureDataset(document.courseId, document.course.name);

    // 2. Read file from disk
    const filePath = path.join(process.cwd(), document.storagePath);
    const fileBuffer = await fs.readFile(filePath);

    // 3. Upload to RAGFlow
    const ragflowDocId = await ragflow.uploadDocument(datasetId, fileBuffer, document.name);

    // 4. Save RAGFlow document ID to local DB
    //    If this fails, clean up the RAGFlow document to prevent orphans
    try {
      await prisma.document.update({
        where: { id: documentId },
        data: { ragflowDocumentId: ragflowDocId },
      });
    } catch (dbError) {
      log.error(`Failed to save ragflowDocumentId — cleaning up RAGFlow document`, dbError);
      await ragflow.deleteDocument(datasetId, [ragflowDocId]).catch(() => {});
      throw dbError;
    }

    // 5. Trigger parsing
    await ragflow.startParsing(datasetId, [ragflowDocId]);

    // 6. Poll for completion
    const finalStatus = await pollParsingStatus(datasetId, ragflowDocId);

    if (finalStatus === 'DONE') {
      await prisma.document.update({
        where: { id: documentId },
        data: { indexStatus: 'indexed', indexError: null },
      });

      log.info(`Successfully indexed document: ${documentId}`);
      return { documentId, status: 'indexed', chunksCreated: 0 };
    } else {
      const errorMsg = 'RAGFlow parsing failed';
      await prisma.document.update({
        where: { id: documentId },
        data: { indexStatus: 'failed', indexError: errorMsg },
      });

      return { documentId, status: 'failed', chunksCreated: 0, error: errorMsg };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`Failed to index document ${documentId}:`, error);

    await prisma.document.update({
      where: { id: documentId },
      data: { indexStatus: 'failed', indexError: errorMessage },
    });

    return { documentId, status: 'failed', chunksCreated: 0, error: errorMessage };
  }
}

/**
 * Index all pending/failed documents in a course
 */
export async function indexCourseDocuments(courseId: string): Promise<IndexingResult[]> {
  const documents = await prisma.document.findMany({
    where: {
      courseId,
      indexStatus: { in: ['pending', 'failed'] },
    },
  });

  log.info(`Found ${documents.length} documents to index in course ${courseId}`);

  const results: IndexingResult[] = [];

  for (const doc of documents) {
    const result = await indexDocument(doc.id);
    results.push(result);
  }

  return results;
}

/**
 * Re-index a document (delete old RAGFlow doc, upload fresh)
 */
export async function reindexDocument(documentId: string): Promise<IndexingResult> {
  const document = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { course: true },
  });

  // Delete old RAGFlow document if it exists
  if (document.ragflowDocumentId && document.course.ragflowDatasetId) {
    try {
      await ragflow.deleteDocument(document.course.ragflowDatasetId, [document.ragflowDocumentId]);
    } catch (error) {
      log.warn(`Failed to delete old RAGFlow document during reindex:`, error);
    }
  }

  // Clear RAGFlow document ID and reset status
  await prisma.document.update({
    where: { id: documentId },
    data: { ragflowDocumentId: null, indexStatus: 'pending', indexError: null },
  });

  return indexDocument(documentId);
}
