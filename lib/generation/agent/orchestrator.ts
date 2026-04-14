/**
 * Generation Agent Orchestrator (Phase A)
 *
 * Drives a sequence of subagent invocations, maintains an activity tree, and
 * emits `GenerationAgentEvent`s that the UI consumes via SSE.
 *
 * In Phase A the dispatch order is deterministic and mirrors the legacy
 * `generateClassroom()` pipeline exactly. Phase B will replace this dispatcher
 * with an LLM-driven planner using Anthropic `tool_use`.
 *
 * Concurrency: scene-content → scene-action → scene-composer is invoked once
 * per outline; a small in-file pool runs up to `SCENE_CONCURRENCY` outlines in
 * parallel (scenes are independent).
 *
 * Output validation: every subagent's return value is validated via its
 * `outputSchema` before being returned. Validation failure is terminal for
 * Phase A.
 */

import { nanoid } from 'nanoid';
import { createLogger } from '@/lib/logger';
import type { AICallFn, AgentInfo } from '@/lib/generation/pipeline-types';
import { applyOutlineFallbacks } from '@/lib/generation/outline-generator';
import type { StageAPI } from '@/lib/api/stage-api';
import type { Scene } from '@/lib/types/stage';
import type { SceneOutline } from '@/lib/types/generation';
import type { AgentActivityNode, SubagentContext, SubagentDefinition } from './types';
import type { GenerationAgentEvent } from './events';
import { stampEvent } from './events';
import { applyEventToNode, nodeFromStartedEvent } from './node-reducer';
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

const log = createLogger('GenerationAgent:Orchestrator');

const SCENE_CONCURRENCY = 3;

export interface OrchestratorInput {
  requirement: string;
  language: 'zh-CN' | 'en-US';
  aiCall: AICallFn;
  lightweightAiCall?: AICallFn;
  baseUrl: string;
  agents: AgentInfo[];
  stageApi: StageAPI;
  stageId: string;
  pdfText?: string;
  teacherContext?: string;
  enableWebSearch?: boolean;
  webSearchApiKey?: string;
  enableImageGeneration?: boolean;
  enableVideoGeneration?: boolean;
  enableTTS?: boolean;
  courseId?: string;
  availableDocuments?: Array<{ id: string; name: string }>;
}

export interface OrchestratorOutput {
  outlines: SceneOutline[];
  scenes: Scene[];
  agentTree: AgentActivityNode[];
}

export type OrchestratorEventListener = (event: GenerationAgentEvent) => void;

/**
 * Activity tree: mutable map of nodes keyed by id, plus event broadcasting.
 * Node mutations share the same reducer as the client-side Zustand store so
 * both views cannot diverge.
 */
class ActivityTree {
  private readonly nodes = new Map<string, AgentActivityNode>();
  private readonly listeners: OrchestratorEventListener[] = [];

  addListener(listener: OrchestratorEventListener): void {
    this.listeners.push(listener);
  }

  emit(event: GenerationAgentEvent): void {
    const stamped = stampEvent(event);
    this.applyEventToTree(stamped);
    for (const l of this.listeners) {
      try {
        l(stamped);
      } catch (err) {
        log.warn('Listener threw while handling event', err);
      }
    }
  }

  addNode(node: AgentActivityNode): void {
    this.nodes.set(node.id, node);
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      if (parent && !parent.children.includes(node.id)) {
        parent.children.push(node.id);
      }
    }
  }

  snapshot(): AgentActivityNode[] {
    return Array.from(this.nodes.values()).map((n) => ({
      ...n,
      children: [...n.children],
      toolCalls: n.toolCalls.map((t) => ({ ...t })),
    }));
  }

  private applyEventToTree(event: GenerationAgentEvent): void {
    if (!('nodeId' in event) || !event.nodeId) return;
    const current = this.nodes.get(event.nodeId);
    if (!current) return;
    const next = applyEventToNode(current, event);
    if (next !== current) this.nodes.set(event.nodeId, next);
  }
}

/**
 * Runs a single subagent end-to-end: validates input, emits lifecycle events,
 * enforces a timeout, validates output, returns the typed value.
 */
async function runSubagent<I, O>(
  tree: ActivityTree,
  def: SubagentDefinition<I, O>,
  input: I,
  ctxBase: Omit<SubagentContext, 'nodeId' | 'parentId' | 'emit'>,
  parentId: string | null,
  labelOverride?: string,
  inputSummary?: string,
): Promise<O> {
  const nodeId = nanoid(8);
  const label = labelOverride ?? def.label;

  const parsedInput = def.inputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new Error(`Subagent ${def.id} input validation failed: ${parsedInput.error.message}`);
  }

  const startedEvent = {
    type: 'agent.started' as const,
    nodeId,
    parentId,
    subagentId: def.id,
    label,
    inputSummary,
  };
  tree.addNode(nodeFromStartedEvent(startedEvent));
  tree.emit(startedEvent);

  const ctx: SubagentContext = {
    ...ctxBase,
    emit: (e) => tree.emit(e),
    nodeId,
    parentId,
  };

  const timeoutMs = def.timeoutMs ?? 120000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Subagent ${def.id} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    const execPromise = (async (): Promise<O> => {
      const gen = def.run(parsedInput.data as I, ctx);
      while (true) {
        const r = await gen.next();
        if (r.done) return r.value as O;
        tree.emit(r.value);
      }
    })();

    const output = await Promise.race([execPromise, timeoutPromise]);

    const parsedOutput = def.outputSchema.safeParse(output);
    if (!parsedOutput.success) {
      throw new Error(`Subagent ${def.id} output validation failed: ${parsedOutput.error.message}`);
    }

    const outputSummary = summarizeOutput(def.id, parsedOutput.data as unknown);
    tree.emit({ type: 'agent.completed', nodeId, outputSummary });
    tree.emit({ type: 'agent.checkpoint', nodeId, key: def.id });

    return parsedOutput.data as O;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    tree.emit({ type: 'agent.failed', nodeId, error: message, retryable: false });
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function summarizeOutput(subagentId: string, output: unknown): string | undefined {
  if (output == null) return undefined;
  if (typeof output !== 'object') return undefined;
  const o = output as Record<string, unknown>;
  if ('outlines' in o && Array.isArray(o.outlines)) return `${o.outlines.length} outlines`;
  if ('actions' in o && Array.isArray(o.actions)) return `${o.actions.length} actions`;
  if ('sceneId' in o) return `sceneId=${o.sceneId ?? 'null'}`;
  if ('mediaCount' in o) return `${o.mediaCount} files`;
  if ('sourcesCount' in o) return `${o.sourcesCount} sources`;
  if ('executed' in o && Array.isArray(o.executed)) return `${o.executed.length} plugins`;
  if ('ok' in o) return o.ok ? 'ok' : 'failed';
  if (subagentId === 'requirement-analyzer' && 'topic' in o)
    return `topic=${String(o.topic ?? '?').slice(0, 60)}`;
  if ('text' in o && typeof o.text === 'string') return `${o.text.length} chars context`;
  return undefined;
}

/**
 * Simple concurrency pool — replaces `p-limit` for Phase A.
 */
async function runPool<T>(limit: number, tasks: Array<() => Promise<T>>): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  };
  const workers: Array<Promise<void>> = [];
  for (let w = 0; w < Math.min(limit, tasks.length); w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/**
 * Deterministic Phase A planner — mirrors the legacy generateClassroom
 * pipeline, but every step is wrapped as a subagent so events flow through a
 * single channel.
 */
export async function runGenerationAgent(
  input: OrchestratorInput,
  options?: { onEvent?: OrchestratorEventListener },
): Promise<OrchestratorOutput> {
  const tree = new ActivityTree();
  if (options?.onEvent) tree.addListener(options.onEvent);

  const ctxBase: Omit<SubagentContext, 'nodeId' | 'parentId' | 'emit'> = {
    aiCall: input.aiCall,
    lightweightAiCall: input.lightweightAiCall,
    language: input.language,
    courseId: input.courseId,
    baseUrl: input.baseUrl,
    agents: input.agents,
    stageApi: input.stageApi,
  };

  // 1. Web research (optional)
  let researchContext: string | undefined;
  if (input.enableWebSearch && input.webSearchApiKey) {
    const result = await runSubagent(
      tree,
      webResearcherSubagent,
      {
        requirement: input.requirement,
        pdfText: input.pdfText,
        apiKey: input.webSearchApiKey,
      },
      ctxBase,
      null,
    );
    researchContext = result.context;
  }

  // 2. Stage 0: requirement analysis
  const analysis = await runSubagent(
    tree,
    requirementAnalyzerSubagent,
    {
      requirement: input.requirement,
      language: input.language,
      pdfContent: input.pdfText,
      researchContext,
      availableDocuments: input.availableDocuments,
    },
    ctxBase,
    null,
  );

  // 3. RAG retrieval (optional)
  let documentContext: string | undefined;
  if (input.courseId) {
    const ragQuery = analysis?.ragQuery || input.requirement;
    const docIds = analysis?.referencedDocumentIds?.length
      ? analysis.referencedDocumentIds
      : undefined;
    const ragResult = await runSubagent(
      tree,
      ragRetrieverSubagent,
      {
        courseId: input.courseId,
        query: ragQuery,
        topK: 8,
        maxTokens: 3000,
        documentIds: docIds,
      },
      ctxBase,
      null,
      undefined,
      `query="${ragQuery.substring(0, 60)}"`,
    );
    documentContext = ragResult?.text;
  }

  // 4. Stage 1: outline generation
  const { outlines } = await runSubagent(
    tree,
    outlineGeneratorSubagent,
    {
      requirement: analysis?.enrichedRequirement || input.requirement,
      language: input.language,
      pdfText: input.pdfText,
      researchContext,
      teacherContext: input.teacherContext,
      documentContext,
      imageGenerationEnabled: input.enableImageGeneration,
      videoGenerationEnabled: input.enableVideoGeneration,
    },
    ctxBase,
    null,
  );

  tree.emit({
    type: 'agent.progress',
    pct: 30,
    message: `Generated ${outlines.length} scene outlines`,
    step: 'generating_outlines',
    scenesGenerated: 0,
    totalScenes: outlines.length,
  });

  // 5. Stage 2: per-outline content → actions → compose (concurrent)
  const sceneTasks = outlines.map((rawOutline, index) => async () => {
    const safeOutline = applyOutlineFallbacks(rawOutline, true);

    const content = await runSubagent(
      tree,
      sceneContentGeneratorSubagent,
      { outline: safeOutline, agents: input.agents },
      ctxBase,
      null,
      `Scene ${index + 1}: ${safeOutline.title}`,
    );

    if (!content) {
      log.warn(`Scene "${safeOutline.title}" content failed; skipping`);
      return;
    }

    const { actions } = await runSubagent(
      tree,
      sceneActionGeneratorSubagent,
      { outline: safeOutline, content, agents: input.agents },
      ctxBase,
      null,
      `Actions: ${safeOutline.title}`,
    );

    await runSubagent(
      tree,
      sceneComposerSubagent,
      { outline: safeOutline, content, actions },
      ctxBase,
      null,
      `Compose: ${safeOutline.title}`,
    );

    tree.emit({
      type: 'agent.progress',
      pct: 30 + Math.floor(((index + 1) / outlines.length) * 60),
      message: `Scene ${index + 1}/${outlines.length}`,
      step: 'generating_scenes',
      scenesGenerated: (input.stageApi.scene.list().data ?? []).length,
      totalScenes: outlines.length,
    });
  });

  await runPool(SCENE_CONCURRENCY, sceneTasks);
  const scenes = input.stageApi.scene.list().data ?? [];

  // 6. Media (optional)
  if (input.enableImageGeneration || input.enableVideoGeneration) {
    await runSubagent(
      tree,
      mediaGeneratorSubagent,
      { outlines, stageId: input.stageId, baseUrl: input.baseUrl },
      ctxBase,
      null,
    );
  }

  // 7. TTS (optional)
  if (input.enableTTS && scenes.length > 0) {
    await runSubagent(
      tree,
      ttsGeneratorSubagent,
      { scenes, stageId: input.stageId, baseUrl: input.baseUrl },
      ctxBase,
      null,
    );
  }

  return {
    outlines,
    scenes,
    agentTree: tree.snapshot(),
  };
}

export type { AgentActivityNode } from './types';
