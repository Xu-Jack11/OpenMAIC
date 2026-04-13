/**
 * RAG Module
 *
 * Retrieval-Augmented Generation system for course documents.
 * Backed by RAGFlow for document indexing, parsing, and retrieval.
 * Provides document context for classroom generation, PBL projects, and discussions.
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
