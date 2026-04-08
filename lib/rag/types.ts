/**
 * RAG Module Types
 *
 * Type definitions for the RAG (Retrieval-Augmented Generation) system
 * that provides document context for classroom generation and discussions.
 */

/**
 * Document chunk with metadata for storage
 */
export interface DocumentChunkData {
  content: string;
  chunkIndex: number;
  metadata?: ChunkMetadata;
}

/**
 * Chunk metadata for context reconstruction
 */
export interface ChunkMetadata {
  pageNumber?: number;
  sectionTitle?: string;
  documentName?: string;
  documentType?: string;
  startChar?: number;
  endChar?: number;
}

/**
 * Retrieved chunk with similarity score
 */
export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
  metadata?: ChunkMetadata;
}

/**
 * Retrieval options for querying documents
 */
export interface RetrievalOptions {
  courseId: string;
  query: string;
  topK?: number;
  similarityThreshold?: number;
  maxTokens?: number;
}

/**
 * Formatted context for prompt injection
 */
export interface DocumentContext {
  text: string;
  sources: Array<{
    documentId: string;
    documentName: string;
    chunkCount: number;
  }>;
  totalChunks: number;
  truncated: boolean;
}

/**
 * Embedding provider configuration
 */
export interface EmbeddingProviderConfig {
  provider: 'openai' | 'local';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  dimensions?: number;
}

/**
 * Chunking configuration
 */
export interface ChunkingConfig {
  chunkSize?: number; // Target tokens per chunk (default: 512)
  chunkOverlap?: number; // Overlap tokens (default: 50)
  minChunkSize?: number; // Minimum chunk size (default: 100)
}

/**
 * Indexing job status
 */
export type IndexStatus = 'pending' | 'indexing' | 'indexed' | 'failed';

/**
 * Indexing result
 */
export interface IndexingResult {
  documentId: string;
  status: IndexStatus;
  chunksCreated: number;
  error?: string;
}
