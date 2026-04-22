/**
 * RAG Module — self-hosted pgvector backend.
 *
 * Document indexing (chunking + embedding + pgvector storage) and retrieval
 * (multi-path recall, RRF fusion, rerank) for course documents. Powers
 * classroom generation, PBL projects, and live discussions.
 */

export { indexDocument, indexCourseDocuments, reindexDocument } from './indexer';
export { retrieveChunks, retrieveChunksFromCourses, getCourseIndexingStatus } from './retriever';
export {
  buildDocumentContext,
  formatChunksAsContext,
  getDocumentContextSummary,
} from './context-builder';
export { deleteDocumentImages, deleteCourseImages } from './image-storage';

export type {
  ChunkType,
  ContextPart,
  DocumentContext,
  IndexStatus,
  IndexingResult,
  PreparedChunk,
  RetrievalOptions,
  RetrievedChunk,
} from './types';
