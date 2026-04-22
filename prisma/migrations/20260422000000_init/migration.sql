-- OpenMAIC initial schema.
--
-- Creates all application tables plus the `pgvector` extension. The
-- `document_chunks` table is created here with only its scalar columns;
-- the `embedding` (halfvec) and `contentTsv` (tsvector) columns plus the
-- HNSW / GIN indexes are added at install time by
-- `scripts/apply-rag-migration.ts`, which probes the embedding endpoint to
-- determine the correct vector dimension.
--
-- Prerequisites for a fresh Postgres instance:
--   - The openmaic role exists and owns the target database.
--   - The `vector` extension is available (pgvector installed).
--   - The role running this migration has `CREATE EXTENSION` privilege on
--     the database, or a superuser has already run `CREATE EXTENSION vector`
--     and `ALTER EXTENSION vector OWNER TO openmaic`.

-- =============================================================================
-- Extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "vector";

-- =============================================================================
-- Enums
-- =============================================================================

CREATE TYPE "Role" AS ENUM ('TEACHER', 'STUDENT');

-- =============================================================================
-- Tables
-- =============================================================================

-- Users --------------------------------------------------------------------
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account" TEXT,
    "passwordHash" TEXT,
    "avatar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- Session tokens -----------------------------------------------------------
CREATE TABLE "session_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_tokens_pkey" PRIMARY KEY ("id")
);

-- Courses ------------------------------------------------------------------
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- Course members -----------------------------------------------------------
CREATE TABLE "course_members" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_members_pkey" PRIMARY KEY ("id")
);

-- Classrooms ---------------------------------------------------------------
CREATE TABLE "classrooms" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "storageId" TEXT NOT NULL,
    "sceneCount" INTEGER NOT NULL DEFAULT 0,
    "language" TEXT,
    "style" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- Documents ----------------------------------------------------------------
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "indexStatus" TEXT NOT NULL DEFAULT 'pending',
    "indexError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- Document chunks (scalar columns only; embedding + tsvector added later) --
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "chunkType" TEXT NOT NULL DEFAULT 'text',
    "content" TEXT,
    "imagePath" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- Invitation codes ---------------------------------------------------------
CREATE TABLE "invitation_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "invitation_codes_pkey" PRIMARY KEY ("id")
);

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE UNIQUE INDEX "users_account_key" ON "users"("account");

CREATE UNIQUE INDEX "session_tokens_token_key" ON "session_tokens"("token");
CREATE INDEX "session_tokens_token_idx" ON "session_tokens"("token");
CREATE INDEX "session_tokens_userId_idx" ON "session_tokens"("userId");

CREATE INDEX "courses_creatorId_idx" ON "courses"("creatorId");

CREATE INDEX "course_members_userId_idx" ON "course_members"("userId");
CREATE UNIQUE INDEX "course_members_courseId_userId_key"
    ON "course_members"("courseId", "userId");

CREATE UNIQUE INDEX "classrooms_storageId_key" ON "classrooms"("storageId");
CREATE INDEX "classrooms_courseId_idx" ON "classrooms"("courseId");
CREATE INDEX "classrooms_creatorId_idx" ON "classrooms"("creatorId");

CREATE INDEX "documents_courseId_idx" ON "documents"("courseId");

CREATE INDEX "document_chunks_documentId_chunkIndex_idx"
    ON "document_chunks"("documentId", "chunkIndex");

CREATE UNIQUE INDEX "invitation_codes_code_key" ON "invitation_codes"("code");
CREATE INDEX "invitation_codes_code_idx" ON "invitation_codes"("code");
CREATE INDEX "invitation_codes_courseId_idx" ON "invitation_codes"("courseId");

-- =============================================================================
-- Foreign keys
-- =============================================================================

ALTER TABLE "session_tokens" ADD CONSTRAINT "session_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "courses" ADD CONSTRAINT "courses_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "course_members" ADD CONSTRAINT "course_members_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "courses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "course_members" ADD CONSTRAINT "course_members_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "courses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "documents" ADD CONSTRAINT "documents_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "courses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaderId_fkey"
    FOREIGN KEY ("uploaderId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitation_codes" ADD CONSTRAINT "invitation_codes_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "courses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
