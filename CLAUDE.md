# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenMAIC (Open Multi-Agent Interactive Classroom) is an AI platform that turns topics or documents into interactive classroom experiences. It generates slides, quizzes, interactive simulations, and project-based learning activities, delivered by AI teacher/classmate agents with speech, whiteboard drawing, and real-time discussion.

Tech stack: Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, Zustand, LangGraph, Vercel AI SDK, Dexie (IndexedDB), pnpm monorepo.

## Commands

```bash
# Install dependencies (also builds workspace packages via postinstall)
pnpm install

# Development server (http://localhost:3000)
pnpm dev

# Production build and start
pnpm build && pnpm start

# CI checks (run all before submitting PRs)
pnpm check          # Prettier format check
pnpm lint           # ESLint
npx tsc --noEmit    # TypeScript type check
pnpm test           # Vitest unit tests (tests/**/*.test.ts)

# Fix formatting/lint
pnpm format         # Prettier auto-fix
pnpm lint --fix     # ESLint auto-fix

# Run a single unit test
npx vitest run tests/path/to/file.test.ts

# E2E tests (Playwright, uses port 3002)
pnpm test:e2e                    # Headless
pnpm test:e2e:ui                 # Interactive UI mode
pnpm exec playwright install chromium --with-deps  # Install browsers first

# Docker
cp .env.example .env.local  # configure API keys
docker compose up --build

# Prisma (server-side database)
npx prisma migrate dev --name <name>  # Run migration
npx prisma generate                  # Regenerate Prisma client
npx prisma studio                    # DB browser
```

## Architecture

### Four Core Engines

The system is built around four engines that form the main processing pipeline:

1. **Generation Pipeline** (`lib/generation/` + `lib/server/classroom-generation.ts`):
   - **Production entry point**: `POST /api/course/[courseId]/classrooms` -> `generateClassroom()` in `lib/server/classroom-generation.ts` (authenticated, course-scoped)
   - Stage 0 (`requirement-analyzer.ts`): Enriches raw user requirement via LLM -- extracts topic, audience, depth, and a focused RAG query
   - Stage 1 (`outline-generator.ts`): Enriched requirement -> structured scene outlines via LLM
   - Stage 2 (`scene-generator.ts`): Each outline -> full scene content (slides, quiz, interactive HTML, PBL) + actions
   - `generation-pipeline.ts` is a barrel re-export for shared types and utilities (`AgentInfo`, `parseJsonResponse`, `formatTeacherPersonaForPrompt`, etc.)
   - Prompts live in `lib/generation/prompts/templates/` as markdown files with `{{variable}}` interpolation and `{{snippet:name}}` includes from `snippets/`
   - Client-side streaming path: `app/api/generate/scene-outlines-stream/route.ts` + `app/api/generate/scene-content/route.ts` (used by `lib/hooks/use-scene-generator.ts`)

2. **Multi-Agent Orchestration** (`lib/orchestration/`) -- LangGraph StateGraph:
   - `director-graph.ts`: `START -> director -> agent_generate -> director (loop) -> END`
   - Director decides which agent speaks next (code-only for single agent, LLM-based for multi-agent)
   - Agent generate node streams SSE events (agent_start, text_delta, action, agent_end) via `config.writer()`
   - Fully stateless: all state travels with the request (`StatelessChatRequest`), server-generated agent configs included

3. **Playback Engine** (`lib/playback/engine.ts`) -- State machine for classroom delivery:
   - States: `idle -> playing -> paused` and `idle -> live` (for discussions)
   - Consumes `Scene.actions[]` sequentially via ActionEngine
   - Handles TTS playback (pre-generated audio, browser Web Speech API, or reading-time timer fallback)
   - Manages discussion triggers (ProactiveCard), user interrupts, pause/resume with snapshot save/restore

4. **Action Engine** (`lib/action/engine.ts`) -- Executes all agent actions:
   - Fire-and-forget: spotlight, laser (visual effects on slides)
   - Synchronous: speech, whiteboard ops (wb_open, wb_draw_text, wb_draw_shape, wb_draw_chart, wb_draw_latex, wb_draw_table, wb_clear, wb_delete, wb_close), play_video, discussion
   - Shared by both streaming (online) and playback (offline) paths

### Data Flow

```
User Input -> Requirement Analysis -> RAG Context -> Outline Generation -> Scene Content + Actions
                                                                                    |
                                                     Stored in Zustand (StageStore) + Prisma (Classroom)
                                                                                    |
                                              Playback Engine consumes actions sequentially
                                                                                    |
                                              Action Engine executes each action on the stage
```

For live discussion, the chat API (`/api/chat`) receives full client state, runs the LangGraph orchestration graph, and streams back SSE events that the client applies to the stage in real time.

### Scene Types

Four scene types defined in `lib/types/stage.ts` as `SceneType`:
- `slide` -- Canvas-based slides with elements (text, image, shape, table, chart, LaTeX)
- `quiz` -- Multiple choice, short answer with AI grading
- `interactive` -- Self-contained HTML simulations
- `pbl` -- Project-Based Learning with roles, milestones, MCP tools

### State Management

- **Zustand stores** in `lib/store/`: `stage.ts` (scenes, current scene, mode), `canvas.ts` (editor state, whiteboard), `settings.ts` (provider config, TTS, ASR, persisted to localStorage), `keyboard.ts`, `media-generation.ts`
- **Client-side persistence**: Dexie (IndexedDB) for classroom data, localStorage for settings
- **Server-side persistence**: PostgreSQL via Prisma 7 for users, courses, classrooms, documents (RAG chunks stored in RAGFlow)
  - Prisma config: no `url` in datasource block; `prisma.config.ts` sets `datasource.url` for migrations; `lib/server/db.ts` passes `datasourceUrl` to PrismaClient via `@prisma/adapter-pg`
  - Generated client output: `lib/generated/prisma/`
  - Migrations: `npx prisma migrate dev --name <name>`; `npx prisma generate` to regenerate client

### Course & Auth System

`lib/server/auth/` handles authentication and course membership:
- **Auth flow**: Invitation codes (6-char) + session tokens (32-char, bearer token in Authorization header)
- **Password auth**: `password.ts` (bcrypt hashing), `tokens.ts` (session token CRUD), `middleware.ts` (bearer token extraction/validation)
- **RBAC**: TEACHER (edit courses) | STUDENT (read-only), enforced via `lib/server/permissions.ts`
- **API format**: REST with `{ success: true, data }` or `{ success: false, errorCode, error, details }`

### RAG System (self-hosted pgvector)

`lib/rag/` indexes documents into PostgreSQL (with the `pgvector` extension) and retrieves chunks using multi-path recall + rerank. **All inference stays on-prem** — embedding, rerank, and VLM parsing point at self-hosted vLLM / MinerU services. No SaaS calls.

**Pipeline**:
1. **Parse** (`mineru-client.ts`, falls back to `lib/document/`): PDFs go through self-hosted MinerU (`mineru[core,vllm]`, port 8003 by default) which returns structured blocks — text, tables (as Markdown), formulas (as LaTeX), and images with captions. Non-PDF formats use `lib/document/` as before.
2. **Chunk** (`chunker.ts`): semantic split targeting ~800 tokens with ~120-token overlap, CJK-aware. Tables / formulas / figures become their own chunks.
3. **Embed** (`embedding-client.ts`): Vercel AI SDK `embedMany` against vLLM `qwen3-vl-embedding` (multimodal — text and images share one vector space).
4. **Store** (`pgvector-store.ts`): raw SQL inserts into `document_chunks` (PK, FK on `documents(id)` CASCADE, `embedding vector(N)`, `contentTsv tsvector GENERATED`). Indexes: HNSW on embedding (cosine) + GIN on tsvector + B-tree on `(documentId, chunkIndex)`.

**Retrieval** (`retriever.ts` → `buildDocumentContext`):
1. **Query rewrite** (`query-rewrite.ts`): one local LLM call produces 3 paraphrases + a HyDE hypothetical answer. Reuses `lib/ai/providers.ts` (override via `RAG_REWRITE_MODEL`, defaults to `DEFAULT_MODEL`).
2. **Multi-path recall**: vector search for original + rewrites + HyDE (`pgvector <=>`) PLUS full-text search on the original query (`websearch_to_tsquery` + `ts_rank_cd`), all in parallel.
3. **RRF fusion** (`rrf.ts`): reciprocal-rank merge with `k=60` across all paths.
4. **Rerank** (`rerank-client.ts`): top-`RAG_CANDIDATE_K` candidates re-scored by vLLM `qwen3-vl-rerank`, final `RAG_TOP_K` returned.

**Image chunks**: stored under `data/documents/{courseId}/{docId}/images/{chunkId}.{ext}`, referenced via `DocumentChunk.imagePath`. `DocumentContext.text` renders them as `[图: caption]` placeholders (for text-only downstream LLMs). `DocumentContext.parts` carries the structured form for future VLM callers.

**Setup**:
- Fresh database: `bash scripts/setup-db.sh` (runs `prisma migrate deploy` + `prisma generate` + `apply-rag-migration.ts`, optionally handling pgvector extension ownership if `SUPERUSER_URL` is set).
- Manual flow: `npx prisma migrate deploy && npx tsx scripts/apply-rag-migration.ts` (the rag script probes the embedding endpoint to auto-detect the vector dim and adds the `embedding halfvec(N)` column + HNSW/GIN indexes to `document_chunks`).
- Connectivity smoke test: `npx tsx scripts/test-rag-connectivity.ts`.

**Env vars**: `EMBEDDING_BASE_URL/API_KEY/MODEL`, `RERANK_BASE_URL/API_KEY/MODEL`, `MINERU_BASE_URL/BACKEND`, `RAG_TOP_K`, `RAG_CANDIDATE_K`, `RAG_MAX_CONTEXT_TOKENS`, `RAG_ENABLE_REWRITE/HYDE/FTS`, optional `RAG_REWRITE_MODEL`.

**Graceful degradation**: if `EMBEDDING_BASE_URL` is unset, retrieval returns empty context and all consumers continue without document grounding. If MinerU is unreachable, the indexer falls back to `lib/document/` parsers (text-only chunks).

**Consumers**: `buildDocumentContext()` is used by `lib/server/classroom-generation.ts`, `/api/chat`, `/api/pbl/chat`, `/api/generate/scene-outlines-stream`, and `lib/generation/agent/subagents/rag-retriever.ts`.

### Document Parsing

`lib/document/` handles multi-format document parsing:
- `parse-document.ts` -- Main entry, routes by MIME type
- `format-detector.ts` -- File type detection
- Parsers: `pdf.ts` (unpdf or MinerU), `docx.ts`, `pptx.ts`, `markdown.ts`, `text.ts`, `image.ts`
- API: `POST /api/parse-document` (text extraction), `POST /api/parse-pdf` (PDF-specific with image extraction)

### Plugin System

`lib/plugins/` provides a declarative skill system for supplementary content generation:
- Built-in plugins: `handout`, `experiment`, `extended-reading` (each has a YAML manifest + TSX preview)
- `registry.ts` -- Plugin discovery and loading
- `skill-loader.ts` / `user-skill-loader.ts` -- YAML manifest parsing
- `plugin-auto-generator.ts` -- Auto-generates plugin content after scene creation
- Teachers can create custom skills via `components/supplementary/custom-skill-editor.tsx`

### AI Provider System

`lib/ai/providers.ts` defines a provider registry supporting: OpenAI, Anthropic, Google Gemini, DeepSeek, Kimi, MiniMax, GLM, Qwen, SiliconFlow, Doubao, Grok. Providers use three SDK types: `openai` (native + OpenAI-compatible), `anthropic` (native + MiniMax), `google`. Model string format: `providerId:modelId` (e.g., `google:gemini-3-flash-preview`).

Server-side provider config can come from environment variables or `server-providers.yml`. Client-side config is stored in `providersConfig` in localStorage.

### API Routes

All in `app/api/`. Key endpoints:
- `/api/chat` -- Stateless multi-agent discussion (SSE streaming)
- `/api/course/[courseId]/classrooms` -- Authenticated classroom generation (POST creates async job, GET lists classrooms)
- `/api/generate-classroom/[jobId]` -- Poll generation job status
- `/api/generate/*` -- Individual generation steps (outlines, scene-content, scene-actions, image, tts, video, handout, experiment, reading, skill, custom-skill, skill-definition)
- `/api/parse-pdf`, `/api/parse-document` -- Document parsing (unpdf or MinerU)
- `/api/pbl/chat` -- PBL-specific chat with MCP tools
- `/api/web-search` -- Tavily or Grok web search
- `/api/quiz-grade` -- AI quiz grading
- `/api/course/auth/*` -- Auth endpoints (create-course, join, register, login, logout, me)
- `/api/course/[courseId]/*` -- Course CRUD, members, documents, invitations

### Prompt System

Generation prompts are markdown templates in `lib/generation/prompts/templates/{promptId}/system.md` and `user.md`. Shared fragments live in `snippets/` (action-types, element-types, json-output-rules). The loader (`prompts/loader.ts`) reads from filesystem, caches in memory, and supports `{{snippet:name}}` inclusion and `{{variable}}` interpolation.

### Workspace Packages

Two internal packages in `packages/` (built during `pnpm install` via postinstall):
- `pptxgenjs` -- Customized PowerPoint generation for slide export
- `mathml2omml` -- MathML to Office Math XML conversion for PPTX LaTeX support

### i18n

`lib/i18n/` has translation modules (common, stage, chat, generation, settings) for `zh-CN` and `en-US`. All user-facing strings must be internationalized -- do not hardcode UI text. Use `getClientTranslation(key)` on the client.

## Code Conventions

- **Path aliases**: `@/*` maps to project root (configured in tsconfig.json)
- **Prettier**: 100 char width, single quotes, trailing commas, 2-space indent, LF line endings
- **ESLint**: next/core-web-vitals + next/typescript. Unused vars with `_` prefix are allowed. `@next/next/no-img-element` is off (dynamic AI-generated image URLs)
- **Commit messages**: Conventional Commits format: `feat(scope): description`, `fix(scope): description`, etc.
- **Branch naming**: `feat/`, `fix/`, `docs/` prefixes
- **Logging**: Use `createLogger('ModuleName')` from `lib/logger.ts` -- not raw `console.log`
- **Node version**: >= 20 (`.nvmrc` specifies 22)
- **Package manager**: pnpm 10 (enforced via `packageManager` field)
- **PRs**: Every PR must link to an issue (`Closes #123`). Refactor-only PRs not accepted unless explicitly requested by a maintainer. AI-assisted PRs must be marked and self-reviewed before requesting maintainer review.
