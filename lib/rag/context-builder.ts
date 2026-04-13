/**
 * Context Builder
 *
 * Formats retrieved document chunks into structured context
 * suitable for injection into LLM prompts.
 */

import { prisma } from '@/lib/server/db';
import { createLogger } from '@/lib/logger';
import { retrieveChunks } from './retriever';
import type { RetrievedChunk, DocumentContext, RetrievalOptions } from './types';

const log = createLogger('RAG:ContextBuilder');

// Default maximum tokens for context
const DEFAULT_MAX_CONTEXT_TOKENS = 2000;

/**
 * Rough token estimation (~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build document context for prompt injection
 */
export async function buildDocumentContext(
  options: RetrievalOptions,
): Promise<DocumentContext | null> {
  const { maxTokens = DEFAULT_MAX_CONTEXT_TOKENS } = options;

  // Retrieve relevant chunks
  const chunks = await retrieveChunks(options);

  if (chunks.length === 0) {
    log.info('No relevant document chunks found');
    return null;
  }

  // Build context with token budget
  return formatChunksAsContext(chunks, maxTokens);
}

/**
 * Build context from pre-retrieved chunks
 */
export function formatChunksAsContext(
  chunks: RetrievedChunk[],
  maxTokens: number = DEFAULT_MAX_CONTEXT_TOKENS,
): DocumentContext {
  const contextParts: string[] = [];
  const sourceMap = new Map<string, { documentId: string; documentName: string; count: number }>();
  let totalTokens = 0;
  let truncated = false;
  let includedChunks = 0;

  for (const chunk of chunks) {
    const chunkTokens = estimateTokens(chunk.content);

    // Check if adding this chunk would exceed budget
    if (totalTokens + chunkTokens > maxTokens) {
      // Try to include partial content if significant space remains
      const remainingTokens = maxTokens - totalTokens;
      if (remainingTokens > 100) {
        const truncatedContent = truncateToTokens(chunk.content, remainingTokens);
        contextParts.push(formatChunk(chunk, truncatedContent));
        includedChunks++;
        trackSource(sourceMap, chunk);
      }
      truncated = true;
      break;
    }

    contextParts.push(formatChunk(chunk, chunk.content));
    totalTokens += chunkTokens;
    includedChunks++;
    trackSource(sourceMap, chunk);
  }

  // Build final context text with header
  const header =
    '## 课程文档参考资料\n\n以下是与当前主题相关的课程文档摘录，请在生成内容时参考这些资料：\n';
  const text = header + contextParts.join('\n\n---\n\n');

  // Build sources array
  const sources = Array.from(sourceMap.values()).map((s) => ({
    documentId: s.documentId,
    documentName: s.documentName,
    chunkCount: s.count,
  }));

  log.info(
    `Built context: ${includedChunks} chunks from ${sources.length} documents, truncated: ${truncated}`,
  );

  return {
    text,
    sources,
    totalChunks: includedChunks,
    truncated,
  };
}

/**
 * Format a single chunk for context
 */
function formatChunk(chunk: RetrievedChunk, content: string): string {
  return `### 来源: ${chunk.documentName}\n\n${content}`;
}

/**
 * Track source document for summary
 */
function trackSource(
  sourceMap: Map<string, { documentId: string; documentName: string; count: number }>,
  chunk: RetrievedChunk,
): void {
  const existing = sourceMap.get(chunk.documentId);
  if (existing) {
    existing.count++;
  } else {
    sourceMap.set(chunk.documentId, {
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      count: 1,
    });
  }
}

/**
 * Truncate text to approximately N tokens
 */
function truncateToTokens(text: string, targetTokens: number): string {
  const targetChars = targetTokens * 4; // Approximate chars per token

  if (text.length <= targetChars) {
    return text;
  }

  // Try to break at sentence boundary
  const truncated = text.slice(0, targetChars);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('。'),
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('！'),
    truncated.lastIndexOf('？'),
  );

  if (lastSentenceEnd > targetChars * 0.7) {
    return truncated.slice(0, lastSentenceEnd + 1) + '...';
  }

  // Break at word boundary
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > targetChars * 0.8) {
    return truncated.slice(0, lastSpace) + '...';
  }

  return truncated + '...';
}

/**
 * Build a simple summary of available documents (for UI display)
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
