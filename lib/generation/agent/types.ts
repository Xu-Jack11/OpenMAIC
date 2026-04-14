/**
 * Generation Agent — Core Types (Phase A)
 *
 * Defines the contract for subagents and the activity tree shape used by the
 * orchestrator and the frontend UI. This file is intentionally framework-agnostic:
 * subagents are pure async iterables emitting events, wrapping existing legacy
 * generation functions without changing their behavior.
 */

import type { z } from 'zod';
import type { StageAPI } from '@/lib/api/stage-api';
import type { AICallFn, AgentInfo } from '@/lib/generation/pipeline-types';
import type { GenerationAgentEvent } from './events';

/**
 * Subagent run context — passed to every subagent's `run()` method.
 *
 * Carries the resolved LLM call function, the event emitter (for the
 * orchestrator to hear the subagent's events), an abort signal, and
 * per-run metadata shared between subagents.
 */
export interface SubagentContext {
  /** LLM call primitive (wraps callLLM). All subagents should use this. */
  aiCall: AICallFn;
  /** Dedicated LLM call for lightweight/cheap tasks (e.g. search query rewrite). */
  lightweightAiCall?: AICallFn;
  /** Emit an event up to the orchestrator. */
  emit: (event: GenerationAgentEvent) => void;
  /** Abort signal for cooperative cancellation. */
  signal?: AbortSignal;
  /** Preferred language for generated content. */
  language: 'zh-CN' | 'en-US';
  /** Optional course id for RAG retrieval. */
  courseId?: string;
  /** Resolved base URL for media/storage writes. */
  baseUrl: string;
  /** Resolved agents (teacher/assistant/student personas). */
  agents: AgentInfo[];
  /**
   * Shared stage store API — scene-composer writes into this; other subagents
   * may read from `ctx.stageApi.getState()` if they need scene state.
   */
  stageApi?: StageAPI;
  /** Per-node identifier assigned by the orchestrator. */
  nodeId: string;
  /** Parent node id, or null for the root subagent. */
  parentId: string | null;
}

/**
 * Declarative subagent definition — mirrors the Anthropic tool_use shape so a
 * future LLM planner (Phase B) can surface each definition as a tool.
 *
 * In Phase A the orchestrator dispatches subagents by id deterministically; the
 * `inputSchema`/`outputSchema` still power strict Zod validation at the
 * subagent boundary.
 */
export interface SubagentDefinition<I = unknown, O = unknown> {
  /** Stable identifier, e.g. 'requirement-analyzer'. */
  id: string;
  /** Short label shown in the UI tree (i18n key or plain text). */
  label: string;
  /** Natural-language description shown to the planner LLM (Phase B). */
  description: string;
  /** Input validation schema. */
  inputSchema: z.ZodType<I>;
  /** Output validation schema. */
  outputSchema: z.ZodType<O>;
  /** Optional timeout (ms); orchestrator enforces, default 120000. */
  timeoutMs?: number;
  /** Optional retry count on validation failure; default 1. */
  maxRetries?: number;
  /** True if this subagent streams text deltas during execution. */
  streaming?: boolean;
  /**
   * Async generator executor.
   *
   * - Yields {@link GenerationAgentEvent}s to surface progress to the UI.
   * - Returns the typed output `O` when the generator completes normally.
   * - On failure, throws — the orchestrator emits an `agent.failed` event and
   *   records the error on the activity node.
   *
   * The orchestrator wraps emission so subagents do not need to emit
   * `agent.started` or `agent.completed`/`agent.failed` themselves.
   */
  run(input: I, ctx: SubagentContext): AsyncGenerator<GenerationAgentEvent, O, void>;
}

/**
 * Node in the agent activity tree — one per subagent invocation. Persisted
 * inside the classroom generation job file so reconnecting clients can replay
 * history.
 */
export interface AgentActivityNode {
  id: string;
  parentId: string | null;
  subagentId: string;
  label: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  startedAt?: number;
  completedAt?: number;
  /** Child node ids in dispatch order. */
  children: string[];
  /** Inline tool calls this subagent made (e.g. rag.search). */
  toolCalls: Array<{
    id: string;
    name: string;
    status: 'running' | 'succeeded' | 'failed';
    argsPreview?: string;
    resultSummary?: string;
  }>;
  /** Accumulated text preview for streaming subagents (soft-capped). */
  textPreview?: string;
  /** Short one-line summary of the input, rendered in the UI. */
  inputSummary?: string;
  /** Short one-line summary of the output, set on completion. */
  outputSummary?: string;
  /** Terminal error message, set on failure. */
  error?: string;
}

/** Minimal handle used by the orchestrator to register nodes. */
export interface OrchestratorHandle {
  /** Create a new node under `parentId` and return its id. */
  createNode(input: {
    subagentId: string;
    label: string;
    parentId: string | null;
    inputSummary?: string;
  }): string;
  /** Emit an already-shaped GenerationAgentEvent. */
  emit: (event: GenerationAgentEvent) => void;
}
