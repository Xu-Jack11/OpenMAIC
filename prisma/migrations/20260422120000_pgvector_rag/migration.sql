-- Migration: Replace RAGFlow external service with in-process RAG backed by pgvector
--
-- Changes:
--   1. Enable the pgvector extension
--   2. Re-create the `document_chunks` table with embedding + tsvector columns
--   3. Drop RAGFlow foreign-key columns from `courses` and `documents`
--
-- After running, re-embed every previously indexed document via
-- `npx tsx scripts/reindex-all-documents.ts`.

-- 1. Enable pgvector
CREATE EXTENSION IF NOT EXISTS "vector";

-- 2. Chunk table with BM25 tsvector and dense embedding.
--    Embedding dimensions default to 1024 to match text-embedding-3-small (truncated),
--    Qwen `text-embedding-v3`, Doubao `doubao-embedding-large`, and GLM `embedding-3`.
--    If you change EMBEDDING_DIMENSIONS in .env, update the vector(N) column to match.
CREATE TABLE "document_chunks" (
    "id"          TEXT NOT NULL,
    "documentId"  TEXT NOT NULL,
    "courseId"    TEXT NOT NULL,
    "content"     TEXT NOT NULL,
    "embedding"   vector(1024),
    "chunkIndex"  INTEGER NOT NULL,
    "tokenCount"  INTEGER NOT NULL DEFAULT 0,
    "metadata"    JSONB,
    "tsv"         tsvector GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "document_chunks_documentId_idx" ON "document_chunks"("documentId");
CREATE INDEX "document_chunks_courseId_idx"   ON "document_chunks"("courseId");
CREATE INDEX "document_chunks_tsv_idx"        ON "document_chunks" USING GIN("tsv");
-- HNSW index for cosine similarity (pgvector >= 0.5). Small m/ef_construction are fine
-- for the typical per-course corpus size; tune later if recall drops.
CREATE INDEX "document_chunks_embedding_idx"
    ON "document_chunks"
    USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

ALTER TABLE "document_chunks"
    ADD CONSTRAINT "document_chunks_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_chunks"
    ADD CONSTRAINT "document_chunks_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "courses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Drop RAGFlow columns
ALTER TABLE "courses"   DROP COLUMN IF EXISTS "ragflowDatasetId";
ALTER TABLE "documents" DROP COLUMN IF EXISTS "ragflowDocumentId";
