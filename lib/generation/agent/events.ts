/**
 * Generation Agent — SSE Event Union (Phase A)
 *
 * Wire-level events streamed from the generation orchestrator to the browser.
 * Event payloads are serializable JSON; a companion Zod schema validates
 * payloads at the transport boundary.
 */

import { z } from 'zod';

const baseEvent = z.object({
  nodeId: z.string().optional(),
  parentId: z.string().nullable().optional(),
  timestamp: z.number().optional(),
});

export const agentStartedEvent = baseEvent.extend({
  type: z.literal('agent.started'),
  nodeId: z.string(),
  parentId: z.string().nullable(),
  subagentId: z.string(),
  label: z.string(),
  inputSummary: z.string().optional(),
});

export const agentThinkingEvent = baseEvent.extend({
  type: z.literal('agent.thinking'),
  nodeId: z.string(),
  stage: z.string().optional(),
});

export const agentToolCallEvent = baseEvent.extend({
  type: z.literal('agent.tool_call'),
  nodeId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  argsPreview: z.string().optional(),
});

export const agentToolResultEvent = baseEvent.extend({
  type: z.literal('agent.tool_result'),
  nodeId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  ok: z.boolean(),
  summary: z.string().optional(),
});

export const agentTextDeltaEvent = baseEvent.extend({
  type: z.literal('agent.text_delta'),
  nodeId: z.string(),
  delta: z.string(),
});

export const agentProgressEvent = baseEvent.extend({
  type: z.literal('agent.progress'),
  nodeId: z.string().optional(),
  pct: z.number().min(0).max(100),
  message: z.string(),
  step: z.string().optional(),
  scenesGenerated: z.number().optional(),
  totalScenes: z.number().optional(),
});

export const agentCompletedEvent = baseEvent.extend({
  type: z.literal('agent.completed'),
  nodeId: z.string(),
  outputSummary: z.string().optional(),
});

export const agentFailedEvent = baseEvent.extend({
  type: z.literal('agent.failed'),
  nodeId: z.string(),
  error: z.string(),
  retryable: z.boolean().optional(),
});

export const agentCheckpointEvent = baseEvent.extend({
  type: z.literal('agent.checkpoint'),
  nodeId: z.string(),
  key: z.string(),
});

export const classroomDoneEvent = baseEvent.extend({
  type: z.literal('classroom.done'),
  classroomId: z.string(),
  url: z.string(),
  scenesCount: z.number(),
});

export const generationAgentEventSchema = z.discriminatedUnion('type', [
  agentStartedEvent,
  agentThinkingEvent,
  agentToolCallEvent,
  agentToolResultEvent,
  agentTextDeltaEvent,
  agentProgressEvent,
  agentCompletedEvent,
  agentFailedEvent,
  agentCheckpointEvent,
  classroomDoneEvent,
]);

export type GenerationAgentEvent = z.infer<typeof generationAgentEventSchema>;
export type GenerationAgentEventType = GenerationAgentEvent['type'];

/** Stamp `timestamp` (and passthrough the rest) before wire serialization. */
export function stampEvent(event: GenerationAgentEvent): GenerationAgentEvent {
  return { ...event, timestamp: event.timestamp ?? Date.now() };
}
