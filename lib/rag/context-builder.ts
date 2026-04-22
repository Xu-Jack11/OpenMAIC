/**
 * Context Builder — turns retrieved chunks into a prompt-ready context.
 *
 * Text-only callers read `DocumentContext.text`. Multimodal-capable callers
 * can walk `DocumentContext.parts` to construct a Vercel AI SDK message
 * with inline images. Image chunks without a caption degrade to a generic
 * `[图: <document name>]` placeholder in the text view, ensuring no chunk
 * is silently dropped.
 */

import { prisma } from '@/lib/server/db';
import { createLogger } from '@/lib/logger';
import { retrieveChunks } from './retriever';
import type { ContextPart, DocumentContext, RetrievalOptions, RetrievedChunk } from './types';

const log = createLogger('RAG:ContextBuilder');

const DEFAULT_MAX_CONTEXT_TOKENS = 2000;
const HEADER =
  '## 课程文档参考资料\n\n以下是与当前主题相关的课程文档摘录,请在生成内容时参考这些资料:\n';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build document context from retrieval options (performs the retrieval).
 */
export async function buildDocumentContext(
  options: RetrievalOptions,
): Promise<DocumentContext | null> {
  const chunks = await retrieveChunks(options);
  if (chunks.length === 0) {
    log.info('No relevant document chunks found');
    return null;
  }
  return formatChunksAsContext(chunks, options.maxTokens ?? DEFAULT_MAX_CONTEXT_TOKENS);
}

/**
 * Build context from already-retrieved chunks.
 */
export function formatChunksAsContext(
  chunks: RetrievedChunk[],
  maxTokens: number = DEFAULT_MAX_CONTEXT_TOKENS,
): DocumentContext {
  const textSegments: string[] = [];
  const parts: ContextPart[] = [{ type: 'text', value: HEADER }];
  const sourceMap = new Map<string, { documentId: string; documentName: string; count: number }>();

  let totalTokens = estimateTokens(HEADER);
  let truncated = false;
  let includedChunks = 0;

  for (const chunk of chunks) {
    const rendered = renderChunkForText(chunk);
    const chunkTokens = estimateTokens(rendered);

    if (totalTokens + chunkTokens > maxTokens) {
      truncated = true;
      break;
    }

    textSegments.push(rendered);
    parts.push({ type: 'text', value: rendered });
    if (chunk.chunkType === 'image' && chunk.imagePath) {
      parts.push({
        type: 'image',
        path: chunk.imagePath,
        caption: chunk.content || undefined,
      });
    }

    totalTokens += chunkTokens;
    includedChunks++;
    trackSource(sourceMap, chunk);
  }

  const text = HEADER + textSegments.join('\n\n---\n\n');
  const sources = Array.from(sourceMap.values()).map((s) => ({
    documentId: s.documentId,
    documentName: s.documentName,
    chunkCount: s.count,
  }));

  log.info(
    `Built context: ${includedChunks} chunks from ${sources.length} documents, truncated: ${truncated}`,
  );

  return { text, parts, sources, totalChunks: includedChunks, truncated };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderChunkForText(chunk: RetrievedChunk): string {
  const header = `### 来源: ${chunk.documentName}`;
  if (chunk.chunkType === 'image') {
    const caption = chunk.content?.trim();
    const placeholder = caption ? `[图: ${caption}]` : `[图: ${chunk.documentName}]`;
    return `${header}\n\n${placeholder}`;
  }
  if (chunk.chunkType === 'table') {
    return `${header} (表格)\n\n${chunk.content}`;
  }
  if (chunk.chunkType === 'formula') {
    return `${header} (公式)\n\n$${chunk.content}$`;
  }
  return `${header}\n\n${chunk.content}`;
}

function trackSource(
  map: Map<string, { documentId: string; documentName: string; count: number }>,
  chunk: RetrievedChunk,
): void {
  const existing = map.get(chunk.documentId);
  if (existing) existing.count++;
  else
    map.set(chunk.documentId, {
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      count: 1,
    });
}

/**
 * UI helper (preserved from prior API).
 */
export async function getDocumentContextSummary(courseId: string): Promise<{
  documentsAvailable: number;
  documentsIndexed: number;
}> {
  const [documentsAvailable, documentsIndexed] = await Promise.all([
    prisma.document.count({ where: { courseId } }),
    prisma.document.count({ where: { courseId, indexStatus: 'indexed' } }),
  ]);
  return { documentsAvailable, documentsIndexed };
}
