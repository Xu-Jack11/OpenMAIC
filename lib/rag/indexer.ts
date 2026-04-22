/**
 * Document Indexer — self-hosted pgvector pipeline.
 *
 * For each document:
 *   1. Guard against concurrent indexing via `indexStatus` column
 *   2. Read the source file from disk
 *   3. Parse:
 *        - PDF (or DOCX/image when MinerU supports them): MinerU if configured
 *        - everything else (or MinerU failure): lib/document/parse-document.ts
 *   4. `chunker.chunkFromMineru` or `chunker.chunkFromParsed` → PreparedChunk[]
 *   5. Embed chunks (text via embedTexts, image via embedImages)
 *   6. Save image buffers to data/documents/{courseId}/{docId}/images/
 *   7. Transaction: delete existing chunks, insert new chunks
 *   8. Mark document as `indexed` / `failed`
 */

import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/server/db';
import { createLogger } from '@/lib/logger';
import { parseDocument } from '@/lib/document/parse-document';
import { detectFormat } from '@/lib/document/format-detector';
import * as mineru from './mineru-client';
import * as embedding from './embedding-client';
import { chunkFromMineru, chunkFromParsed } from './chunker';
import { deleteChunksByDocument, insertChunks, type InsertChunk } from './pgvector-store';
import { deleteDocumentImages, saveChunkImage } from './image-storage';
import type { IndexingResult, PreparedChunk } from './types';

const log = createLogger('RAG:Indexer');

// Concurrency: an indexing that's been "indexing" for this long is assumed stale.
const STALE_INDEXING_MS = 10 * 60 * 1000;

/**
 * Index a single document. Safe to call concurrently for distinct documents;
 * for the same document, concurrent callers short-circuit on `indexStatus`.
 */
export async function indexDocument(documentId: string): Promise<IndexingResult> {
  log.info(`Starting indexing for document: ${documentId}`);

  if (!embedding.isConfigured()) {
    const msg = 'Embedding endpoint is not configured';
    log.warn(msg);
    await markFailed(documentId, msg);
    return { documentId, status: 'failed', chunksCreated: 0, error: msg };
  }

  const document = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { course: { select: { id: true } } },
  });

  // Concurrency guard
  if (document.indexStatus === 'indexing') {
    const age = Date.now() - document.createdAt.getTime();
    if (age < STALE_INDEXING_MS) {
      log.warn(`Document ${documentId} is already being indexed — skipping`);
      return { documentId, status: 'indexing', chunksCreated: 0 };
    }
    log.warn(`Document ${documentId} stuck in 'indexing' >10min — resetting`);
  }

  await prisma.document.update({
    where: { id: documentId },
    data: { indexStatus: 'indexing', indexError: null },
  });

  try {
    const fileBuffer = await fs.readFile(path.join(process.cwd(), document.storagePath));

    // 1. Parse
    const prepared = await parseToChunks(document.name, document.mimeType, fileBuffer);
    log.info(`Doc ${documentId}: parsed into ${prepared.length} candidate chunks`);

    if (prepared.length === 0) {
      await markIndexed(documentId);
      return { documentId, status: 'indexed', chunksCreated: 0 };
    }

    // 2. Split chunks by type for embedding
    const textIdx: number[] = [];
    const imageIdx: number[] = [];
    prepared.forEach((p, i) => {
      if (p.chunkType === 'image') imageIdx.push(i);
      else textIdx.push(i);
    });

    // For text-like chunks (text/table/formula) embed the content directly.
    // For image chunks, if caption is present, we still embed the IMAGE (not
    // the caption) so visual similarity drives retrieval.
    const textInputs = textIdx.map((i) => prepared[i].content);
    const imageInputs = imageIdx
      .map((i) => prepared[i])
      .filter((p): p is PreparedChunk & { imageBuffer: Buffer } => Boolean(p.imageBuffer))
      .map((p) => ({ buffer: p.imageBuffer!, ext: p.imageExt ?? 'png' }));

    const [textVecs, imageVecs] = await Promise.all([
      embedding.embedTexts(textInputs),
      embedding.embedImages(imageInputs),
    ]);

    // 3. Persist image files + compose InsertChunk rows
    // Ensure clean image directory before writing (also handles reindex).
    await deleteDocumentImages(document.course.id, documentId);

    const rows: InsertChunk[] = [];
    let textCursor = 0;
    let imageCursor = 0;

    for (let i = 0; i < prepared.length; i++) {
      const p = prepared[i];
      const id = randomUUID();

      if (p.chunkType === 'image') {
        if (!p.imageBuffer) continue;
        const imagePath = await saveChunkImage(
          document.course.id,
          documentId,
          id,
          p.imageBuffer,
          p.imageExt ?? 'png',
        );
        const vec = imageVecs[imageCursor++];
        if (!vec || vec.length === 0) {
          log.warn(`Missing image embedding at chunk ${i}; skipping`);
          continue;
        }
        rows.push({
          id,
          chunkIndex: i,
          chunkType: 'image',
          content: p.content,
          imagePath,
          metadata: p.metadata ?? null,
          embedding: vec,
        });
      } else {
        const vec = textVecs[textCursor++];
        if (!vec || vec.length === 0) {
          log.warn(`Missing text embedding at chunk ${i}; skipping`);
          continue;
        }
        rows.push({
          id,
          chunkIndex: i,
          chunkType: p.chunkType,
          content: p.content,
          imagePath: null,
          metadata: p.metadata ?? null,
          embedding: vec,
        });
      }
    }

    // 4. Transactional replace
    await prisma.$transaction(async (tx) => {
      await deleteChunksByDocument(tx, documentId);
      await insertChunks(tx, documentId, rows);
    });

    await markIndexed(documentId);
    log.info(`Successfully indexed document ${documentId} with ${rows.length} chunks`);
    return { documentId, status: 'indexed', chunksCreated: rows.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.error(`Failed to index document ${documentId}:`, err);
    await markFailed(documentId, msg);
    return { documentId, status: 'failed', chunksCreated: 0, error: msg };
  }
}

/**
 * Index all pending/failed documents in a course. Sequential to avoid
 * overwhelming the embedding endpoint.
 */
export async function indexCourseDocuments(courseId: string): Promise<IndexingResult[]> {
  const documents = await prisma.document.findMany({
    where: { courseId, indexStatus: { in: ['pending', 'failed'] } },
  });
  log.info(`Found ${documents.length} documents to index in course ${courseId}`);

  const results: IndexingResult[] = [];
  for (const doc of documents) {
    results.push(await indexDocument(doc.id));
  }
  return results;
}

/**
 * Re-index a document. Deletes existing image files + chunks before a
 * fresh run.
 */
export async function reindexDocument(documentId: string): Promise<IndexingResult> {
  const document = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { course: { select: { id: true } } },
  });

  // Delete old images; chunks will be deleted inside the transaction in indexDocument.
  await deleteDocumentImages(document.course.id, documentId);

  await prisma.document.update({
    where: { id: documentId },
    data: { indexStatus: 'pending', indexError: null },
  });

  return indexDocument(documentId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function markIndexed(documentId: string): Promise<void> {
  await prisma.document.update({
    where: { id: documentId },
    data: { indexStatus: 'indexed', indexError: null },
  });
}

async function markFailed(documentId: string, error: string): Promise<void> {
  await prisma.document.update({
    where: { id: documentId },
    data: { indexStatus: 'failed', indexError: error },
  });
}

/**
 * Parse a file into PreparedChunk[]. Tries MinerU first when available,
 * falls back to lib/document/ on any failure.
 */
async function parseToChunks(
  fileName: string,
  mimeType: string,
  fileBuffer: Buffer,
): Promise<PreparedChunk[]> {
  if (mineru.isConfigured()) {
    try {
      const result = await mineru.parseFile(fileBuffer, fileName, mimeType);
      const chunks = chunkFromMineru(result);
      if (chunks.length > 0) return chunks;
      log.warn('MinerU returned no chunks — falling back to local parser');
    } catch (err) {
      log.warn(`MinerU parse failed (${(err as Error).message}); falling back to local parser`);
    }
  }

  // Fallback to existing lib/document/ parsers.
  // detectFormat accepts a File-like; we construct a minimal stand-in.
  const fileLike = new File([new Uint8Array(fileBuffer)], fileName, { type: mimeType });
  const format = detectFormat(fileLike);
  if (!format) {
    log.warn(`No parser available for ${fileName} (${mimeType})`);
    return [];
  }
  const parsed = await parseDocument({ format }, fileLike);
  return chunkFromParsed(parsed);
}
