/**
 * Document Indexer
 *
 * Processes uploaded documents for RAG retrieval:
 * 1. Extracts text content using existing parsers
 * 2. Chunks the content into semantic segments
 * 3. Generates embeddings for each chunk
 * 4. Stores chunks with embeddings in PostgreSQL (pgvector)
 */

import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/server/db';
import { parseDocument } from '@/lib/document/parse-document';
import { createLogger } from '@/lib/logger';
import { chunkDocument } from './chunker';
import { generateEmbeddings, formatEmbeddingForStorage } from './embeddings';
import type { IndexingResult, ChunkingConfig } from './types';

const log = createLogger('RAG:Indexer');

// Batch size for embedding generation — small default to avoid EPIPE on size-limited servers
const EMBEDDING_BATCH_SIZE = (() => {
  const parsed = Number.parseInt(process.env.RAG_EMBEDDING_BATCH_SIZE || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
})();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConnectionError(error: unknown): boolean {
  const msg = getErrorMessage(error);
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(msg);
}

async function embedRangeWithFallback(
  chunkTexts: string[],
  start: number,
  end: number,
  targetEmbeddings: Array<number[] | undefined>,
): Promise<void> {
  const batch = chunkTexts.slice(start, end);

  try {
    const embeddings = await generateEmbeddings(batch);
    if (embeddings.length !== batch.length) {
      throw new Error(
        `Embedding count mismatch: got ${embeddings.length}, expected ${batch.length}`,
      );
    }

    for (let i = 0; i < embeddings.length; i++) {
      targetEmbeddings[start + i] = embeddings[i];
    }
  } catch (error) {
    const size = end - start;

    // Connection-level failures affect all chunks — no point splitting
    if (isConnectionError(error)) {
      throw new Error(
        `Embedding server unreachable for chunks ${start + 1}-${end}: ${getErrorMessage(error)}`,
      );
    }

    if (size <= 1) {
      throw new Error(`Embedding failed for chunk ${start + 1}: ${getErrorMessage(error)}`);
    }

    const mid = start + Math.floor(size / 2);
    log.warn(
      `Embedding batch failed for chunks ${start + 1}-${end}; splitting into ${start + 1}-${mid} and ${mid + 1}-${end}`,
    );
    await embedRangeWithFallback(chunkTexts, start, mid, targetEmbeddings);
    await embedRangeWithFallback(chunkTexts, mid, end, targetEmbeddings);
  }
}

/**
 * Index a document for RAG retrieval
 *
 * @param documentId - The document ID from the database
 * @param config - Optional chunking configuration
 * @returns Indexing result with status and chunk count
 */
export async function indexDocument(
  documentId: string,
  config?: ChunkingConfig,
): Promise<IndexingResult> {
  log.info(`Starting indexing for document: ${documentId}`);

  try {
    // Fetch document metadata and update status atomically
    const document = await prisma.document.update({
      where: { id: documentId },
      data: { indexStatus: 'indexing', indexError: null },
    });

    // Read file from storage
    const filePath = path.join(process.cwd(), document.storagePath);
    const fileBuffer = await fs.readFile(filePath);
    const fileBlob = new Blob([fileBuffer], { type: document.mimeType });
    const file = new File([fileBlob], document.name, { type: document.mimeType });

    // Parse document to extract text
    log.info(`Parsing document: ${document.name}`);
    const parsed = await parseDocument({}, file);

    if (!parsed.text || parsed.text.trim().length === 0) {
      throw new Error('No text content extracted from document');
    }

    // Determine document type from mime type
    const docType = getDocumentType(document.mimeType);

    // Strip base64-encoded images/data URIs before chunking — they bloat chunks
    // and are meaningless for text embedding
    const cleanedText = parsed.text.replace(/!\[([^\]]*)\]\(data:[^)]+\)/g, (_, alt) =>
      alt ? `[image: ${alt}]` : '[image]',
    );

    // Chunk the document
    log.info(
      `Chunking document: ${cleanedText.length} chars (original: ${parsed.text.length} chars)`,
    );
    const chunks = chunkDocument(cleanedText, document.name, docType, config);

    if (chunks.length === 0) {
      throw new Error('No chunks created from document');
    }

    log.info(`Created ${chunks.length} chunks`);

    // Delete existing chunks for this document (for re-indexing)
    await prisma.documentChunk.deleteMany({
      where: { documentId },
    });

    // Generate embeddings in batches
    const chunkTexts = chunks.map((c) => c.content);
    const allEmbeddings: Array<number[] | undefined> = new Array(chunkTexts.length);

    for (let i = 0; i < chunkTexts.length; i += EMBEDDING_BATCH_SIZE) {
      const batchEnd = Math.min(i + EMBEDDING_BATCH_SIZE, chunkTexts.length);
      log.info(
        `Generating embeddings batch ${Math.floor(i / EMBEDDING_BATCH_SIZE) + 1} (chunks ${i + 1}-${batchEnd}/${chunkTexts.length})`,
      );
      await embedRangeWithFallback(chunkTexts, i, batchEnd, allEmbeddings);
    }

    const resolvedEmbeddings = allEmbeddings.map((embedding, idx) => {
      if (!embedding) {
        throw new Error(`Missing embedding for chunk ${idx + 1}`);
      }
      return embedding;
    });

    // Store chunks with embeddings using batched raw SQL for pgvector
    log.info(`Storing ${chunks.length} chunks with embeddings`);

    const INSERT_BATCH_SIZE = 50;
    for (let batchStart = 0; batchStart < chunks.length; batchStart += INSERT_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + INSERT_BATCH_SIZE, chunks.length);
      const valuePlaceholders: string[] = [];
      const params: unknown[] = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const chunk = chunks[i];
        const embedding = resolvedEmbeddings[i];
        const offset = (i - batchStart) * 6;
        valuePlaceholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::vector, $${offset + 5}, $${offset + 6}, NOW())`,
        );
        params.push(
          `chunk_${documentId}_${i}`,
          documentId,
          chunk.content,
          formatEmbeddingForStorage(embedding),
          chunk.chunkIndex,
          JSON.stringify(chunk.metadata),
        );
      }

      await prisma.$executeRawUnsafe(
        `INSERT INTO document_chunks (id, "documentId", content, embedding, "chunkIndex", metadata, "createdAt")
         VALUES ${valuePlaceholders.join(', ')}`,
        ...params,
      );
    }

    // Update document status to indexed
    await prisma.document.update({
      where: { id: documentId },
      data: { indexStatus: 'indexed', indexError: null },
    });

    log.info(`Successfully indexed document: ${documentId} (${chunks.length} chunks)`);

    return {
      documentId,
      status: 'indexed',
      chunksCreated: chunks.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`Failed to index document ${documentId}:`, error);

    // Update document status to failed
    await prisma.document.update({
      where: { id: documentId },
      data: { indexStatus: 'failed', indexError: errorMessage },
    });

    return {
      documentId,
      status: 'failed',
      chunksCreated: 0,
      error: errorMessage,
    };
  }
}

/**
 * Index all pending documents in a course
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
 * Re-index a document (delete and recreate chunks)
 */
export async function reindexDocument(documentId: string): Promise<IndexingResult> {
  // Reset status to pending first
  await prisma.document.update({
    where: { id: documentId },
    data: { indexStatus: 'pending', indexError: null },
  });

  return indexDocument(documentId);
}

/**
 * Get document type from MIME type
 */
function getDocumentType(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'text',
    'text/markdown': 'markdown',
    'image/png': 'image',
    'image/jpeg': 'image',
    'image/webp': 'image',
  };

  return mimeMap[mimeType] || 'unknown';
}
