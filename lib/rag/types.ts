/**
 * RAG Module Types
 *
 * Type definitions for the RAG (Retrieval-Augmented Generation) system
 * backed by RAGFlow for document indexing and retrieval.
 */

/**
 * Retrieved chunk with similarity score
 */
export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
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
  documentIds?: string[];
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
