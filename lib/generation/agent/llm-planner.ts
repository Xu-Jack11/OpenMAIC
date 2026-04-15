/**
 * LLM-driven planner (Phase B).
 *
 * Lets an Anthropic-style `tool_use` loop decide which subagent to run next,
 * using the Vercel AI SDK's `generateText({ tools, stopWhen })`. Each tool's
 * `execute` dispatches the corresponding subagent via the shared runtime, so
 * progress, activity tree, validation, and timeouts are identical to the
 * deterministic planner.
 *
 * The planner is expected to follow this recipe (enforced loosely by the
 * system prompt and strictly by tool preconditions):
 *
 *   research_web? → analyze_requirement → retrieve_rag? →
 *   generate_outlines → generate_scene × N → generate_media? →
 *   generate_tts? → finish
 *
 * Every tool validates its own preconditions; out-of-order calls return a
 * structured error in the tool result, and the model can self-correct on the
 * next step. `stopWhen` caps the loop at `MAX_PLANNER_STEPS` to guarantee
 * termination; a `finish` tool call exits early.
 */

import { hasToolCall, stepCountIs, tool, type LanguageModel } from 'ai';
import { z } from 'zod';
import { callLLM } from '@/lib/ai/llm';
import { createLogger } from '@/lib/logger';
import type { RequirementAnalysis } from '@/lib/generation/requirement-analyzer';
import type { SceneOutline } from '@/lib/types/generation';
import { applyOutlineFallbacks } from '@/lib/generation/outline-generator';
import {
  mediaGeneratorSubagent,
  outlineGeneratorSubagent,
  ragRetrieverSubagent,
  requirementAnalyzerSubagent,
  sceneActionGeneratorSubagent,
  sceneComposerSubagent,
  sceneContentGeneratorSubagent,
  ttsGeneratorSubagent,
  webResearcherSubagent,
} from './subagents';
import {
  ActivityTree,
  buildCtxBase,
  runSubagent,
  type OrchestratorInput,
  type OrchestratorOutput,
} from './runtime';

const log = createLogger('GenerationAgent:LLMPlanner');

const MAX_PLANNER_STEPS = 30;

/** Mutable state accumulated across tool calls during a single planner run. */
export interface PlannerState {
  analysis?: RequirementAnalysis | null;
  researchContext?: string;
  documentContext?: string;
  outlines?: SceneOutline[];
  completedOutlineIndices: Set<number>;
  mediaGenerated: boolean;
  ttsGenerated: boolean;
  finished: boolean;
  finishReason?: string;
}

/** Fresh state for a single planner run. Exported for tests. */
export function createInitialPlannerState(): PlannerState {
  return {
    completedOutlineIndices: new Set<number>(),
    mediaGenerated: false,
    ttsGenerated: false,
    finished: false,
  };
}

/**
 * Build the planner system prompt. Describes the goal, available tools, and
 * the recipe the planner should follow.
 */
function buildSystemPrompt(input: OrchestratorInput): string {
  const flags: string[] = [];
  flags.push(`enableWebSearch=${Boolean(input.enableWebSearch && input.webSearchApiKey)}`);
  flags.push(`courseId=${input.courseId ? 'present' : 'none'}`);
  flags.push(`enableMedia=${Boolean(input.enableImageGeneration || input.enableVideoGeneration)}`);
  flags.push(`enableTTS=${Boolean(input.enableTTS)}`);

  return `You are the planning agent for an interactive classroom generation system.

Your job: produce a complete classroom for the user's requirement by calling the provided tools in the correct order. You do NOT generate content yourself — each tool wraps a specialized subagent that performs one step. Your job is to choose which tool to call next.

## Run configuration

- Language: ${input.language}
- Flags: ${flags.join(', ')}
- Requirement summary: ${input.requirement.slice(0, 240)}

## Recipe

Follow this order. Skip optional steps only if the corresponding flag is off.

1. (Optional) \`research_web\` — call at most once if enableWebSearch is true.
2. \`analyze_requirement\` — call exactly once before generating outlines.
3. (Optional) \`retrieve_rag\` — call at most once if courseId is present.
4. \`generate_outlines\` — call exactly once. After this, \`outlineCount\` is known.
5. \`generate_scene\` — call once per outline, from index 0 up to outlineCount - 1. The order must be ascending.
6. (Optional) \`generate_media\` — call at most once if enableMedia is true, after all scenes are generated.
7. (Optional) \`generate_tts\` — call at most once if enableTTS is true, after all scenes are generated.
8. \`finish\` — call exactly once, last, to terminate. Tool calls after finish are ignored.

## Rules

- Do not call any tool out of order; tools enforce preconditions and will return an error if violated. If an error is returned, read the message and call the prerequisite tool first.
- Do not call the same tool twice unless the description explicitly says "once per outline".
- Keep your reasoning text short. Prefer making the next tool call over narrating.
- Always end with \`finish\`.`;
}

/**
 * Lazy helper: run a subagent and return its result, or throw an error that
 * will be surfaced to the planner as a tool error (not a hard failure).
 */
class ToolPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolPreconditionError';
  }
}

export interface ToolBuildContext {
  input: OrchestratorInput;
  tree: ActivityTree;
  state: PlannerState;
}

/**
 * Build the tool set for one planner run. Tools close over shared state.
 * Exported so tests can exercise precondition and state-transition logic
 * without round-tripping through a real `LanguageModel`.
 */
export function buildTools(toolCtx: ToolBuildContext) {
  const { input, tree, state } = toolCtx;
  const ctxBase = buildCtxBase(input);

  return {
    research_web: tool({
      description:
        'Run a single web search and store the formatted context. Call at most once, before analyze_requirement.',
      inputSchema: z.object({
        query_hint: z
          .string()
          .optional()
          .describe('Optional phrase to steer the search query rewrite. Usually not needed.'),
      }),
      execute: async () => {
        if (!input.enableWebSearch || !input.webSearchApiKey) {
          return { skipped: true, reason: 'Web search is disabled for this run.' };
        }
        if (state.researchContext !== undefined) {
          return { skipped: true, reason: 'research_web has already been called.' };
        }
        const result = await runSubagent(
          tree,
          webResearcherSubagent,
          { requirement: input.requirement, pdfText: input.pdfText, apiKey: input.webSearchApiKey },
          ctxBase,
          null,
        );
        state.researchContext = result.context ?? '';
        return {
          ok: true,
          sources: result.sourcesCount,
          contextChars: result.context?.length ?? 0,
        };
      },
    }),

    analyze_requirement: tool({
      description:
        'Produce a structured analysis of the user requirement (topic, audience, depth, RAG query, referenced document ids). Call exactly once before generate_outlines.',
      inputSchema: z.object({}),
      execute: async () => {
        if (state.analysis !== undefined) {
          throw new ToolPreconditionError('analyze_requirement has already been called.');
        }
        state.analysis = await runSubagent(
          tree,
          requirementAnalyzerSubagent,
          {
            requirement: input.requirement,
            language: input.language,
            pdfContent: input.pdfText,
            researchContext: state.researchContext,
            availableDocuments: input.availableDocuments,
          },
          ctxBase,
          null,
        );
        return {
          ok: true,
          topic: state.analysis?.topic ?? null,
          audience: state.analysis?.audience ?? null,
          depth: state.analysis?.depth ?? null,
          ragQuery: state.analysis?.ragQuery ?? null,
          referencedDocumentCount: state.analysis?.referencedDocumentIds?.length ?? 0,
        };
      },
    }),

    retrieve_rag: tool({
      description:
        'Retrieve relevant document chunks from the course corpus and store them as context. Requires analyze_requirement to have been called first (for the ragQuery). Call at most once.',
      inputSchema: z.object({
        query_override: z
          .string()
          .optional()
          .describe("Optional explicit query; otherwise the analyzer's ragQuery is used."),
      }),
      execute: async ({ query_override }) => {
        if (!input.courseId) {
          return { skipped: true, reason: 'No courseId on this run; RAG is unavailable.' };
        }
        if (state.analysis === undefined) {
          throw new ToolPreconditionError(
            'analyze_requirement must be called before retrieve_rag.',
          );
        }
        if (state.documentContext !== undefined) {
          return { skipped: true, reason: 'retrieve_rag has already been called.' };
        }
        const query = query_override?.trim() || state.analysis?.ragQuery || input.requirement;
        const result = await runSubagent(
          tree,
          ragRetrieverSubagent,
          {
            courseId: input.courseId,
            query,
            topK: 8,
            maxTokens: 3000,
            documentIds: state.analysis?.referencedDocumentIds?.length
              ? state.analysis.referencedDocumentIds
              : undefined,
          },
          ctxBase,
          null,
          undefined,
          `query="${query.slice(0, 60)}"`,
        );
        state.documentContext = result?.text ?? '';
        return {
          ok: true,
          sources: result?.sources.length ?? 0,
          contextChars: result?.text.length ?? 0,
        };
      },
    }),

    generate_outlines: tool({
      description:
        'Generate the ordered list of scene outlines from the enriched requirement and accumulated context. Call exactly once after analyze_requirement.',
      inputSchema: z.object({}),
      execute: async () => {
        if (state.analysis === undefined) {
          throw new ToolPreconditionError(
            'analyze_requirement must be called before generate_outlines.',
          );
        }
        if (state.outlines) {
          throw new ToolPreconditionError('generate_outlines has already been called.');
        }
        const { outlines } = await runSubagent(
          tree,
          outlineGeneratorSubagent,
          {
            requirement: state.analysis?.enrichedRequirement || input.requirement,
            language: input.language,
            pdfText: input.pdfText,
            researchContext: state.researchContext,
            teacherContext: input.teacherContext,
            documentContext: state.documentContext,
            imageGenerationEnabled: input.enableImageGeneration,
            videoGenerationEnabled: input.enableVideoGeneration,
          },
          ctxBase,
          null,
        );
        state.outlines = outlines;
        tree.emit({
          type: 'agent.progress',
          pct: 30,
          message: `Generated ${outlines.length} scene outlines`,
          step: 'generating_outlines',
          scenesGenerated: 0,
          totalScenes: outlines.length,
        });
        return { ok: true, outlineCount: outlines.length };
      },
    }),

    generate_scene: tool({
      description:
        'Generate the full scene for one outline (content → actions → compose), identified by its zero-based index. Call once per outline in ascending order.',
      inputSchema: z.object({
        outline_index: z
          .number()
          .int()
          .min(0)
          .describe('Zero-based index into the outlines array returned by generate_outlines.'),
      }),
      execute: async ({ outline_index }) => {
        if (!state.outlines) {
          throw new ToolPreconditionError('generate_outlines must be called first.');
        }
        if (outline_index < 0 || outline_index >= state.outlines.length) {
          throw new ToolPreconditionError(
            `outline_index ${outline_index} out of range [0, ${state.outlines.length - 1}]`,
          );
        }
        if (state.completedOutlineIndices.has(outline_index)) {
          return { skipped: true, reason: `Scene ${outline_index} is already generated.` };
        }

        const safeOutline = applyOutlineFallbacks(state.outlines[outline_index], true);
        const title = safeOutline.title;

        const content = await runSubagent(
          tree,
          sceneContentGeneratorSubagent,
          { outline: safeOutline, agents: input.agents },
          ctxBase,
          null,
          `Scene ${outline_index + 1}: ${title}`,
        );
        if (!content) {
          return { ok: false, reason: 'content generation returned null' };
        }
        const { actions } = await runSubagent(
          tree,
          sceneActionGeneratorSubagent,
          { outline: safeOutline, content, agents: input.agents },
          ctxBase,
          null,
          `Actions: ${title}`,
        );
        const { sceneId } = await runSubagent(
          tree,
          sceneComposerSubagent,
          { outline: safeOutline, content, actions },
          ctxBase,
          null,
          `Compose: ${title}`,
        );

        state.completedOutlineIndices.add(outline_index);
        const completed = state.completedOutlineIndices.size;
        const total = state.outlines.length;
        tree.emit({
          type: 'agent.progress',
          pct: 30 + Math.floor((completed / total) * 60),
          message: `Scene ${completed}/${total}`,
          step: 'generating_scenes',
          scenesGenerated: (input.stageApi.scene.list().data ?? []).length,
          totalScenes: total,
        });

        return { ok: true, sceneId: sceneId ?? null, scenesCompleted: completed, total };
      },
    }),

    generate_media: tool({
      description:
        'Generate images/videos referenced by scene outlines and rewrite placeholders. Call at most once, after all scenes are generated.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!state.outlines) {
          throw new ToolPreconditionError('generate_outlines must be called first.');
        }
        if (state.completedOutlineIndices.size !== state.outlines.length) {
          throw new ToolPreconditionError(
            'Not all scenes are generated yet; finish generate_scene calls first.',
          );
        }
        if (!input.enableImageGeneration && !input.enableVideoGeneration) {
          return { skipped: true, reason: 'Media generation is disabled for this run.' };
        }
        if (state.mediaGenerated) {
          return { skipped: true, reason: 'generate_media has already been called.' };
        }
        const result = await runSubagent(
          tree,
          mediaGeneratorSubagent,
          { outlines: state.outlines, stageId: input.stageId, baseUrl: input.baseUrl },
          ctxBase,
          null,
        );
        state.mediaGenerated = true;
        return { ok: true, mediaCount: result.mediaCount };
      },
    }),

    generate_tts: tool({
      description:
        'Synthesize TTS audio for every speech action. Call at most once, after all scenes are generated.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!state.outlines) {
          throw new ToolPreconditionError('generate_outlines must be called first.');
        }
        if (state.completedOutlineIndices.size !== state.outlines.length) {
          throw new ToolPreconditionError(
            'Not all scenes are generated yet; finish generate_scene calls first.',
          );
        }
        if (!input.enableTTS) {
          return { skipped: true, reason: 'TTS is disabled for this run.' };
        }
        if (state.ttsGenerated) {
          return { skipped: true, reason: 'generate_tts has already been called.' };
        }
        const scenes = input.stageApi.scene.list().data ?? [];
        if (scenes.length === 0) {
          return { skipped: true, reason: 'No committed scenes to synthesize.' };
        }
        const result = await runSubagent(
          tree,
          ttsGeneratorSubagent,
          { scenes, stageId: input.stageId, baseUrl: input.baseUrl },
          ctxBase,
          null,
        );
        state.ttsGenerated = true;
        return { ok: true, ok_tts: result.ok };
      },
    }),

    finish: tool({
      description:
        'Signal that classroom generation is complete. Must be the last tool call. Optionally include a brief reason string (for logging).',
      inputSchema: z.object({
        reason: z.string().max(200).optional(),
      }),
      execute: async ({ reason }) => {
        state.finished = true;
        state.finishReason = reason;
        return { ok: true };
      },
    }),
  };
}

/** Pretty-print the initial user message that nudges the planner to start. */
function buildUserMessage(input: OrchestratorInput): string {
  const lines: string[] = [];
  lines.push(`Requirement: ${input.requirement}`);
  if (input.pdfText) lines.push(`PDF provided: ${input.pdfText.length} chars`);
  if (input.availableDocuments?.length)
    lines.push(`Course documents available: ${input.availableDocuments.length}`);
  lines.push('');
  lines.push('Begin by choosing the first tool to call. End with finish.');
  return lines.join('\n');
}

/**
 * Run the LLM planner. Returns the same `OrchestratorOutput` shape as the
 * deterministic planner so the caller doesn't need to branch on mode.
 */
export async function runLLMPlanner(
  input: OrchestratorInput,
  tree: ActivityTree,
  deps: { model: LanguageModel; maxOutputTokens?: number },
): Promise<OrchestratorOutput> {
  const state = createInitialPlannerState();
  const tools = buildTools({ input, tree, state });
  const system = buildSystemPrompt(input);
  const userMessage = buildUserMessage(input);

  await callLLM(
    {
      model: deps.model,
      system,
      prompt: userMessage,
      tools,
      stopWhen: [stepCountIs(MAX_PLANNER_STEPS), hasToolCall('finish')],
      maxOutputTokens: deps.maxOutputTokens,
    },
    'generation-agent-planner',
  );

  if (!state.outlines) {
    throw new Error(
      'LLM planner terminated without calling generate_outlines; no classroom produced.',
    );
  }
  if (state.completedOutlineIndices.size === 0) {
    throw new Error('LLM planner terminated without generating any scenes.');
  }
  if (!state.finished) {
    log.warn('LLM planner stopped due to step limit without calling finish.');
  }

  return {
    outlines: state.outlines,
    scenes: input.stageApi.scene.list().data ?? [],
    agentTree: tree.snapshot(),
  };
}
