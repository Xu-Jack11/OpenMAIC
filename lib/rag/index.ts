/**
 * RAG Module
 *
 * Retrieval-Augmented Generation system for course documents.
 * Backed by pgvector (vector) + tsvector (BM25-style) hybrid search in the
 * project's PostgreSQL database. Embeddings are computed via an OpenAI-
 * compatible provider (see `lib/rag/embedder.ts`). Provides document context
 * for classroom generation, PBL projects, and live discussions.
 */

export { indexDocument, indexCourseDocuments, reindexDocument } from './indexer';
export { retrieveChunks, retrieveChunksFromCourses, getCourseIndexingStatus } from './retriever';
export { buildDocumentContext, formatChunksAsContext } from './context-builder';

export type {
  RetrievedChunk,
  RetrievalOptions,
  DocumentContext,
  IndexStatus,
  IndexingResult,
} from './types';
