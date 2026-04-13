-- Migration: Replace local RAG (pgvector) with RAGFlow external service
--
-- Changes:
--   1. Drop the `document_chunks` table (RAGFlow stores chunks internally)
--   2. Remove the pgvector extension (no longer needed)
--   3. Add `ragflowDatasetId` column to `courses`
--   4. Add `ragflowDocumentId` column to `documents`
--
-- After running this migration, re-upload any existing `indexed` documents
-- via `scripts/migrate-to-ragflow.ts` to register them with RAGFlow.

-- 1. Drop the DocumentChunk table (cascade removes any foreign key references)
DROP TABLE IF EXISTS "document_chunks" CASCADE;

-- 2. Drop pgvector extension (safe even if other databases still use it)
DROP EXTENSION IF EXISTS "vector";

-- 3. Add ragflowDatasetId to courses
ALTER TABLE "courses" ADD COLUMN "ragflowDatasetId" TEXT;

-- 4. Add ragflowDocumentId to documents
ALTER TABLE "documents" ADD COLUMN "ragflowDocumentId" TEXT;
