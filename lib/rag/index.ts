/**
 * RAG Module
 *
 * Retrieval-Augmented Generation system for course documents.
 * Provides document indexing and context retrieval for classroom generation,
 * PBL projects, and discussions.
 */

export { generateEmbedding, generateEmbeddings, getEmbeddingConfig } from './embeddings';
export { chunkDocument, estimateTokens } from './chunker';
export { indexDocument, indexCourseDocuments, reindexDocument } from './indexer';
export { retrieveChunks, retrieveChunksFromCourses, getCourseIndexingStatus } from './retriever';
export { buildDocumentContext, formatChunksAsContext } from './context-builder';

export type {
  DocumentChunkData,
  ChunkMetadata,
  RetrievedChunk,
  RetrievalOptions,
  DocumentContext,
  EmbeddingProviderConfig,
  ChunkingConfig,
  IndexStatus,
  IndexingResult,
} from './types';
