/**
 * Shared reducer applying a {@link GenerationAgentEvent} to an activity node.
 *
 * Used both server-side (orchestrator's in-memory ActivityTree) and
 * client-side (Zustand store) so the two views cannot drift. The reducer is
 * side-effect-free and never allocates when the event is not relevant to the
 * given node — callers mutate the returned node (or the original, if the
 * function returns it unchanged).
 */

import type { AgentActivityNode } from './types';
import type { GenerationAgentEvent } from './events';

const TEXT_PREVIEW_MAX_CHARS = 500;

/**
 * Returns the node updated by the event, or the original node if the event
 * doesn't apply. Caller decides whether to replace the stored node based on
 * reference equality.
 */
export function applyEventToNode(
  node: AgentActivityNode,
  event: GenerationAgentEvent,
): AgentActivityNode {
  switch (event.type) {
    case 'agent.completed':
      return {
        ...node,
        status: 'succeeded',
        completedAt: event.timestamp ?? Date.now(),
        outputSummary: event.outputSummary,
      };
    case 'agent.failed':
      return {
        ...node,
        status: 'failed',
        completedAt: event.timestamp ?? Date.now(),
        error: event.error,
      };
    case 'agent.tool_call':
      return {
        ...node,
        toolCalls: [
          ...node.toolCalls,
          {
            id: event.toolCallId,
            name: event.toolName,
            status: 'running',
            argsPreview: event.argsPreview,
          },
        ],
      };
    case 'agent.tool_result':
      return {
        ...node,
        toolCalls: node.toolCalls.map((t) =>
          t.id === event.toolCallId
            ? {
                ...t,
                status: event.ok ? 'succeeded' : 'failed',
                resultSummary: event.summary,
              }
            : t,
        ),
      };
    case 'agent.text_delta': {
      const next = (node.textPreview ?? '') + event.delta;
      return {
        ...node,
        textPreview:
          next.length > TEXT_PREVIEW_MAX_CHARS ? next.slice(-TEXT_PREVIEW_MAX_CHARS) : next,
      };
    }
    default:
      return node;
  }
}

/** Construct the initial node for an `agent.started` event. */
export function nodeFromStartedEvent(event: {
  nodeId: string;
  parentId: string | null;
  subagentId: string;
  label: string;
  inputSummary?: string;
  timestamp?: number;
}): AgentActivityNode {
  return {
    id: event.nodeId,
    parentId: event.parentId,
    subagentId: event.subagentId,
    label: event.label,
    status: 'running',
    startedAt: event.timestamp ?? Date.now(),
    children: [],
    toolCalls: [],
    inputSummary: event.inputSummary,
  };
}
