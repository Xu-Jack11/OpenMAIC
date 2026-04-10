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

1. **Generation Pipeline** (`lib/generation/`) -- Two-stage lesson creation:
   - Stage 1 (`outline-generator.ts`): User requirements -> structured scene outlines via LLM
   - Stage 2 (`scene-generator.ts`): Each outline -> full scene content (slides, quiz, interactive HTML, PBL)
   - `pipeline-runner.ts` orchestrates both stages with progress callbacks
   - Prompts live in `lib/generation/prompts/templates/` as markdown files with `{{variable}}` interpolation and `{{snippet:name}}` includes from `snippets/`

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
User Input -> Generation Pipeline -> Scenes with Actions -> Stored in Zustand (StageStore)
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
- **Server-side persistence**: PostgreSQL via Prisma 7 for users, courses, classrooms, documents, RAG chunks
  - Prisma config: no `url` in datasource block; `prisma.config.ts` sets `datasource.url` for migrations; `lib/server/db.ts` passes `datasourceUrl` to PrismaClient via `@prisma/adapter-pg`
  - Generated client output: `lib/generated/prisma/`
  - Migrations: `npx prisma migrate dev --name <name>`; `npx prisma generate` to regenerate client

### Course & Auth System

`lib/server/auth/` handles authentication and course membership:
- **Auth flow**: Invitation codes (6-char) + session tokens (32-char, bearer token in Authorization header)
- **Password auth**: `password.ts` (bcrypt hashing), `tokens.ts` (session token CRUD), `middleware.ts` (bearer token extraction/validation)
- **RBAC**: TEACHER (edit courses) | STUDENT (read-only), enforced via `lib/server/permissions.ts`
- **API format**: REST with `{ success: true, data }` or `{ success: false, errorCode, error, details }`

### RAG System

`lib/rag/` provides document indexing and retrieval-augmented generation:
- `indexer.ts` — Splits documents into chunks, generates embeddings, stores in `DocumentChunk` model with pgvector
- `retriever.ts` — Vector similarity search against stored chunks
- `context-builder.ts` — Assembles retrieved chunks into prompt context
- `embeddings.ts` — Embedding provider abstraction (OpenAI default, local fallback)
- `chunker.ts` — Token-aware text splitting with overlap
- Config via env vars: `EMBEDDING_PROVIDER`, `OPENAI_EMBEDDING_API_KEY`, `RAG_CHUNK_SIZE`, `RAG_TOP_K`, etc.

### AI Provider System

`lib/ai/providers.ts` defines a provider registry supporting: OpenAI, Anthropic, Google Gemini, DeepSeek, Kimi, MiniMax, GLM, Qwen, SiliconFlow, Doubao, Grok. Providers use three SDK types: `openai` (native + OpenAI-compatible), `anthropic` (native + MiniMax), `google`. Model string format: `providerId:modelId` (e.g., `google:gemini-3-flash-preview`).

Server-side provider config can come from environment variables or `server-providers.yml`. Client-side config is stored in `providersConfig` in localStorage.

### API Routes

All in `app/api/`. Key endpoints:
- `/api/chat` -- Stateless multi-agent discussion (SSE streaming)
- `/api/generate-classroom` -- Async classroom generation job (POST returns jobId, GET polls status)
- `/api/generate/*` -- Individual generation steps (outlines, scene-content, scene-actions, image, tts, video, handout, experiment, reading, skill, custom-skill, skill-definition)
- `/api/parse-pdf`, `/api/parse-document` -- Document parsing (unpdf or MinerU)
- `/api/pbl/chat` -- PBL-specific chat with MCP tools
- `/api/web-search` -- Tavily or Grok web search
- `/api/quiz-grade` -- AI quiz grading
- `/api/course/auth/*` -- Auth endpoints (create-course, join, register, login, logout, me)
- `/api/course/[courseId]/*` -- Course CRUD, members, classrooms, documents, invitations

### Prompt System

Generation prompts are markdown templates in `lib/generation/prompts/templates/{promptId}/system.md` and `user.md`. Shared fragments live in `snippets/`. The loader (`prompts/loader.ts`) reads from filesystem, caches in memory, and supports `{{snippet:name}}` inclusion and `{{variable}}` interpolation.

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
- **Refactor-only PRs** are not accepted unless explicitly requested by a maintainer
- **AI-assisted PRs** must be marked and self-reviewed before requesting maintainer review
