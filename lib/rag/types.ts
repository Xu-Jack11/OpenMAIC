/**
 * RAG Module Types
 *
 * Types for the self-hosted pgvector RAG system.
 */

/**
 * Kind of a single indexed chunk.
 *
 * - `text`    — plain text segment (paragraph, heading, etc.)
 * - `image`   — figure extracted from the document; image bytes on disk.
 * - `table`   — a table rendered as Markdown/HTML in `content`.
 * - `formula` — a standalone formula rendered as LaTeX in `content`.
 */
export type ChunkType = 'text' | 'image' | 'table' | 'formula';

/**
 * Retrieved chunk with similarity score (returned from retriever).
 */
export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentName: string;
  chunkType: ChunkType;
  /** For text/table/formula: body text. For image: optional caption (may be empty). */
  content: string;
  /** For image chunks: relative filesystem path (under data/documents/...). */
  imagePath?: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

/**
 * Retrieval options.
 */
export interface RetrievalOptions {
  courseId: string;
  query: string;
  topK?: number;
  similarityThreshold?: number;
  maxTokens?: number;
  documentIds?: string[];
  /** Disable query rewriting / HyDE if false. Default true unless env says otherwise. */
  enableRewrite?: boolean;
}

/**
 * Part-based rendering of document context. Callers that build multimodal
 * prompts for VLM models can walk `parts`. Text-only callers use `text`.
 */
export type ContextPart =
  | { type: 'text'; value: string }
  | { type: 'image'; path: string; caption?: string };

/**
 * Formatted context for prompt injection.
 */
export interface DocumentContext {
  /** Flattened plain-text rendering; image chunks appear as `[图: caption]` placeholders. */
  text: string;
  /** Structured parts for multimodal-capable callers. Images keep their disk path. */
  parts: ContextPart[];
  sources: Array<{
    documentId: string;
    documentName: string;
    chunkCount: number;
  }>;
  totalChunks: number;
  truncated: boolean;
}

/**
 * Indexing job status.
 */
export type IndexStatus = 'pending' | 'indexing' | 'indexed' | 'failed';

/**
 * Indexing result.
 */
export interface IndexingResult {
  documentId: string;
  status: IndexStatus;
  chunksCreated: number;
  error?: string;
}

/**
 * A single chunk produced by `chunker.ts` before embedding.
 * Image chunks carry the raw buffer so the indexer can persist them.
 */
export interface PreparedChunk {
  chunkType: ChunkType;
  /** For text/table/formula: the text to embed. For image: the caption (may be empty). */
  content: string;
  /** Present only for image chunks. */
  imageBuffer?: Buffer;
  /** For image chunks: the original file extension (png/jpg/...). */
  imageExt?: string;
  /** Free-form metadata stored alongside the chunk. */
  metadata?: Record<string, unknown>;
}
