/**
 * Document Indexer (pgvector)
 *
 * Processes uploaded documents for RAG retrieval:
 *   1. Reads the file from disk
 *   2. Extracts text via `lib/document/parse-document.ts`
 *   3. Splits text into chunks using LangChain `RecursiveCharacterTextSplitter`
 *   4. Embeds chunks via the configured OpenAI-compatible provider
 *   5. Upserts (documentId, chunkIndex, content, embedding) into `document_chunks`
 *
 * Replaces the previous RAGFlow-backed implementation. All RAG consumers
 * go through the stable facade in `lib/rag/index.ts` — this refactor does not
 * change the exported shape.
 */

import { promises as fs } from 'fs';
import path from 'path';
import pgvector from 'pgvector';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { prisma } from '@/lib/server/db';
import { createLogger } from '@/lib/logger';
import { parseDocument } from '@/lib/document/parse-document';
import { createEmbedder, getEmbedderConfig, isConfigured } from './embedder';
import type { IndexingResult } from './types';

const log = createLogger('RAG:Indexer');

// Chunking configuration
const CHUNK_TOKENS = (() => {
  const n = Number.parseInt(process.env.RAG_CHUNK_TOKENS || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 512;
})();
const CHUNK_OVERLAP_TOKENS = (() => {
  const n = Number.parseInt(process.env.RAG_CHUNK_OVERLAP_TOKENS || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 80;
})();
// Rough char-per-token heuristic (works for CJK + latin mix, slightly conservative).
const CHARS_PER_TOKEN = 4;

// Stale indexing threshold — auto-reset documents stuck in 'indexing' for this long
const STALE_INDEXING_MS = 10 * 60 * 1000;

/**
 * Load file content and extract plain text.
 * Reads the uploaded file from `storagePath` (relative to process.cwd()).
 */
async function extractTextFromStoredFile(
  storagePath: string,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const absolutePath = path.join(process.cwd(), storagePath);
  const buffer = await fs.readFile(absolutePath);

  // parseDocument takes a File (Web API). Construct one from the buffer.
  const file = new File([new Uint8Array(buffer)], fileName, {
    type: mimeType || 'application/octet-stream',
  });

  const parsed = await parseDocument({}, file);
  return parsed.text || '';
}

/**
 * Split text into overlapping chunks.
 *
 * LangChain's RecursiveCharacterTextSplitter prefers sentence/paragraph
 * boundaries, which gives better BM25 + vector recall than naive slicing.
 */
async function splitText(text: string): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_TOKENS * CHARS_PER_TOKEN,
    chunkOverlap: CHUNK_OVERLAP_TOKENS * CHARS_PER_TOKEN,
    separators: ['\n\n', '\n', '。', '！', '？', '.', '!', '?', ';', '；', ' ', ''],
  });

  const chunks = await splitter.splitText(text);
  return chunks.filter((c) => c.trim().length > 0);
}

/**
 * Insert chunks + embeddings in a single transaction.
 * Uses Prisma raw queries so we stay on the same connection pool.
 */
async function upsertChunks(
  courseId: string,
  documentId: string,
  chunks: string[],
  embeddings: number[][],
): Promise<number> {
  if (chunks.length === 0) return 0;
  if (chunks.length !== embeddings.length) {
    throw new Error(
      `Chunk/embedding count mismatch: ${chunks.length} chunks vs ${embeddings.length} embeddings`,
    );
  }

  return prisma.$transaction(async (tx) => {
    // Remove any previous chunks for this document (idempotent re-index)
    await tx.documentChunk.deleteMany({ where: { documentId } });

    // Insert row-by-row — simpler than building a parameterized bulk insert
    // with the vector cast, and fine for the per-doc batch sizes we see.
    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i];
      const embeddingSql = pgvector.toSql(embeddings[i]);
      const tokenCount = Math.ceil(content.length / CHARS_PER_TOKEN);

      await tx.$executeRaw`
        INSERT INTO "document_chunks"
          ("id", "documentId", "courseId", "content", "embedding", "chunkIndex", "tokenCount", "createdAt")
        VALUES
          (gen_random_uuid()::text, ${documentId}, ${courseId}, ${content},
           ${embeddingSql}::vector, ${i}, ${tokenCount}, NOW())
      `;
    }

    return chunks.length;
  });
}

/**
 * Index a document for RAG retrieval
 */
export async function indexDocument(documentId: string): Promise<IndexingResult> {
  log.info(`Starting indexing for document: ${documentId}`);

  if (!isConfigured()) {
    log.warn('Embedding provider is not configured — marking failed');
    await prisma.document.update({
      where: { id: documentId },
      data: { indexStatus: 'failed', indexError: 'Embedding provider is not configured' },
    });
    return {
      documentId,
      status: 'failed',
      chunksCreated: 0,
      error: 'Embedding provider is not configured',
    };
  }

  try {
    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });

    // Guard: prevent concurrent indexing
    if (document.indexStatus === 'indexing') {
      const age = Date.now() - document.createdAt.getTime();
      if (age < STALE_INDEXING_MS) {
        log.warn(`Document ${documentId} is already being indexed — skipping`);
        return { documentId, status: 'indexing', chunksCreated: 0 };
      }
      log.warn(`Document ${documentId} has been stuck in 'indexing' for >10min — resetting`);
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { indexStatus: 'indexing', indexError: null },
    });

    // 1. Extract text
    const text = await extractTextFromStoredFile(
      document.storagePath,
      document.name,
      document.mimeType,
    );

    if (!text.trim()) {
      const msg = 'Document contains no extractable text';
      await prisma.document.update({
        where: { id: documentId },
        data: { indexStatus: 'failed', indexError: msg },
      });
      return { documentId, status: 'failed', chunksCreated: 0, error: msg };
    }

    // 2. Chunk
    const chunks = await splitText(text);
    log.info(`Document ${documentId}: ${text.length} chars → ${chunks.length} chunks`);

    if (chunks.length === 0) {
      const msg = 'Chunking produced no output';
      await prisma.document.update({
        where: { id: documentId },
        data: { indexStatus: 'failed', indexError: msg },
      });
      return { documentId, status: 'failed', chunksCreated: 0, error: msg };
    }

    // 3. Embed — LangChain's OpenAIEmbeddings handles batching internally
    const embedder = createEmbedder();
    const embeddings = await embedder.embedDocuments(chunks);

    // Sanity check: all embeddings must match configured dimension
    const expected = getEmbedderConfig()!.dimensions;
    const actual = embeddings[0]?.length ?? 0;
    if (actual !== expected) {
      throw new Error(
        `Embedding dimension mismatch: provider returned ${actual}, expected ${expected}. ` +
          `Update EMBEDDING_DIMENSIONS and the vector(N) column to match.`,
      );
    }

    // 4. Persist
    const chunksCreated = await upsertChunks(document.courseId, documentId, chunks, embeddings);

    await prisma.document.update({
      where: { id: documentId },
      data: { indexStatus: 'indexed', indexError: null },
    });

    log.info(`Successfully indexed ${documentId}: ${chunksCreated} chunks`);
    return { documentId, status: 'indexed', chunksCreated };
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
    results.push(await indexDocument(doc.id));
  }
  return results;
}

/**
 * Re-index a document (deletes old chunks, re-embeds)
 */
export async function reindexDocument(documentId: string): Promise<IndexingResult> {
  // upsertChunks already deletes existing chunks in-transaction;
  // just reset the status so `indexDocument` proceeds.
  await prisma.document.update({
    where: { id: documentId },
    data: { indexStatus: 'pending', indexError: null },
  });

  return indexDocument(documentId);
}
