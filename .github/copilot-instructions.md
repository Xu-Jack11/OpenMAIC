# GitHub Copilot Instructions for OpenMAIC

OpenMAIC (Open Multi-Agent Interactive Classroom) is an AI platform that turns topics or documents into interactive classroom experiences with slides, quizzes, simulations, and project-based learning—delivered by AI agents with speech and whiteboard capabilities.

**Tech stack**: Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, Zustand, LangGraph, Vercel AI SDK, Dexie (IndexedDB), pnpm monorepo.

## Commands

```bash
pnpm install          # Install deps (builds workspace packages via postinstall)
pnpm dev              # Dev server at http://localhost:3000
pnpm build && pnpm start  # Production build

# CI checks (run before PRs)
pnpm check            # Prettier format check
pnpm lint             # ESLint
npx tsc --noEmit      # TypeScript check
pnpm test             # Vitest unit tests

# Fix formatting/lint
pnpm format           # Prettier auto-fix
pnpm lint --fix       # ESLint auto-fix

# Single test
npx vitest run tests/path/to/file.test.ts

# E2E (Playwright, port 3002)
pnpm test:e2e         # Headless
pnpm test:e2e:ui      # Interactive mode

# Prisma (server-side database)
npx prisma migrate dev --name <name>
npx prisma generate
npx prisma studio
```

## Architecture

### Four Core Engines

1. **Generation Pipeline** (`lib/generation/` + `lib/server/classroom-generation.ts`):
   - Production entry: `POST /api/course/[courseId]/classrooms` → `generateClassroom()`
   - Stage 0 (`requirement-analyzer.ts`): Enriches requirement, extracts focused RAG query
   - Stage 1 (`outline-generator.ts`): Requirement → structured scene outlines
   - Stage 2 (`scene-generator.ts`): Each outline → full scene content + actions
   - Prompts in `lib/generation/prompts/templates/` as markdown with `{{variable}}` interpolation and `{{snippet:name}}` includes

2. **Multi-Agent Orchestration** (`lib/orchestration/`): LangGraph StateGraph
   - `director-graph.ts`: `START → director → agent_generate → director (loop) → END`
   - Fully stateless: all state travels with the request (`StatelessChatRequest`)

3. **Playback Engine** (`lib/playback/engine.ts`): State machine for classroom delivery
   - States: `idle → playing → paused` and `idle → live` (discussions)
   - Handles TTS playback, discussion triggers, pause/resume

4. **Action Engine** (`lib/action/engine.ts`): Executes agent actions
   - Fire-and-forget: spotlight, laser
   - Synchronous: speech, whiteboard ops, play_video, discussion
   - Shared by streaming (online) and playback (offline) paths

### Data Flow

```
User Input → Requirement Analysis → RAG Context → Outlines → Scene Content + Actions
                                                                      ↓
                                        Stored in Zustand (StageStore) + Prisma (Classroom)
                                                                      ↓
                                        Playback Engine → Action Engine → Stage
```

Live discussion: `/api/chat` receives full client state, runs LangGraph graph, streams SSE events.

### Scene Types (`lib/types/stage.ts`)

- `slide`: Canvas-based slides with elements (text, image, shape, table, chart, LaTeX)
- `quiz`: Multiple choice, short answer with AI grading
- `interactive`: Self-contained HTML simulations
- `pbl`: Project-Based Learning with roles, milestones, MCP tools

### State Management

- **Zustand stores** in `lib/store/`: `stage.ts`, `canvas.ts`, `settings.ts`, `keyboard.ts`, `media-generation.ts`
- **Client persistence**: Dexie (IndexedDB) for classroom data, localStorage for settings
- **Server persistence**: PostgreSQL via Prisma 7 for users, courses, classrooms, documents, RAG chunks
  - Generated client: `lib/generated/prisma/`

### AI Provider System

`lib/ai/providers.ts` supports: OpenAI, Anthropic, Google Gemini, DeepSeek, Kimi, MiniMax, GLM, Qwen, SiliconFlow, Doubao, Grok. Model format: `providerId:modelId` (e.g., `google:gemini-3-flash-preview`).

### Key API Routes (`app/api/`)

- `/api/chat`: Stateless multi-agent discussion (SSE)
- `/api/course/[courseId]/classrooms`: Authenticated classroom generation (POST) + list (GET)
- `/api/generate-classroom/[jobId]`: Poll generation job status
- `/api/generate/*`: Individual generation steps
- `/api/course/auth/*`: Auth endpoints (register, login, join, etc.)
- `/api/course/[courseId]/*`: Course CRUD, members, documents, invitations
- `/api/pbl/chat`: PBL chat with MCP tools

### Workspace Packages (`packages/`)

- `pptxgenjs`: PowerPoint generation for slide export
- `mathml2omml`: MathML to Office Math XML for PPTX LaTeX

## Code Conventions

- **Path aliases**: `@/*` maps to project root
- **Prettier**: 100 char, single quotes, trailing commas, 2-space indent, LF
- **ESLint**: next/core-web-vitals + next/typescript; unused vars with `_` prefix allowed
- **Commits**: Conventional Commits (`feat(scope):`, `fix(scope):`, etc.)
- **Branches**: `feat/`, `fix/`, `docs/` prefixes
- **Logging**: Use `createLogger('ModuleName')` from `lib/logger.ts`—not `console.log`
- **i18n**: All UI text must use `getClientTranslation(key)`—no hardcoded strings
- **Node**: ≥20 (`.nvmrc` specifies 22)
- **Package manager**: pnpm 10

## PR Guidelines

- Every PR must link to an issue (`Closes #123`)
- Refactor-only PRs not accepted unless explicitly requested
- AI-assisted PRs must be marked and self-reviewed before requesting maintainer review
