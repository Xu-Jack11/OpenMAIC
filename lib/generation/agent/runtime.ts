/**
 * Generation Agent Runtime (shared by deterministic and LLM planners).
 *
 * Contains the activity tree, subagent execution harness, event emission, and
 * shared input/output types. Both `deterministic-planner.ts` (Phase A) and
 * `llm-planner.ts` (Phase B) run their tool calls through `runSubagent` so
 * every strategy reports progress through the same SSE channel and respects
 * the same timeout/validation semantics.
 */

import { nanoid } from 'nanoid';
import { createLogger } from '@/lib/logger';
import type { LanguageModel } from 'ai';
import type { AICallFn, AgentInfo } from '@/lib/generation/pipeline-types';
import type { StageAPI } from '@/lib/api/stage-api';
import type { Scene } from '@/lib/types/stage';
import type { SceneOutline } from '@/lib/types/generation';
import type { AgentActivityNode, SubagentContext, SubagentDefinition } from './types';
import type { GenerationAgentEvent } from './events';
import { stampEvent } from './events';
import { applyEventToNode, nodeFromStartedEvent } from './node-reducer';

const log = createLogger('GenerationAgent:Runtime');

export interface OrchestratorInput {
  requirement: string;
  language: 'zh-CN' | 'en-US';
  aiCall: AICallFn;
  lightweightAiCall?: AICallFn;
  /**
   * Raw language model, used by the LLM planner for `tool_use` loops where a
   * string-only `aiCall` is insufficient. The deterministic planner does not
   * read this.
   */
  languageModel?: LanguageModel;
  /** Optional output token budget for the LLM planner's `generateText` call. */
  maxOutputTokens?: number;
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
export class ActivityTree {
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

/** Base subagent context (everything except nodeId/parentId/emit). */
export type SubagentContextBase = Omit<SubagentContext, 'nodeId' | 'parentId' | 'emit'>;

export function buildCtxBase(input: OrchestratorInput): SubagentContextBase {
  return {
    aiCall: input.aiCall,
    lightweightAiCall: input.lightweightAiCall,
    language: input.language,
    courseId: input.courseId,
    baseUrl: input.baseUrl,
    agents: input.agents,
    stageApi: input.stageApi,
  };
}

/**
 * Runs a single subagent end-to-end: validates input, emits lifecycle events,
 * enforces a timeout, validates output, returns the typed value.
 */
export async function runSubagent<I, O>(
  tree: ActivityTree,
  def: SubagentDefinition<I, O>,
  input: I,
  ctxBase: SubagentContextBase,
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
 * Simple concurrency pool — a tiny dependency-free alternative to `p-limit`.
 */
export async function runPool<T>(limit: number, tasks: Array<() => Promise<T>>): Promise<T[]> {
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
