/**
 * Unit tests for the generation-agent event hub.
 */

import { describe, expect, it } from 'vitest';
import { generationAgentEventHub } from '@/lib/generation/agent/event-hub';
import type { GenerationAgentEvent } from '@/lib/generation/agent/events';

function startedEvent(nodeId: string, subagentId: string): GenerationAgentEvent {
  return {
    type: 'agent.started',
    nodeId,
    parentId: null,
    subagentId,
    label: subagentId,
  };
}

describe('generationAgentEventHub', () => {
  it('delivers new events to subscribers', () => {
    const jobId = `test-${Math.random().toString(36).slice(2)}`;
    const received: GenerationAgentEvent[] = [];
    const unsubscribe = generationAgentEventHub.subscribe(jobId, (e) => {
      received.push(e);
    });

    generationAgentEventHub.publish(jobId, startedEvent('n1', 'requirement-analyzer'));
    generationAgentEventHub.publish(jobId, startedEvent('n2', 'outline-generator'));

    expect(received).toHaveLength(2);
    expect(received[0].type).toBe('agent.started');
    expect((received[0] as { nodeId: string }).nodeId).toBe('n1');

    unsubscribe();
    generationAgentEventHub.publish(jobId, startedEvent('n3', 'scene-composer'));
    expect(received).toHaveLength(2);
  });

  it('replays buffered events to late subscribers', () => {
    const jobId = `replay-${Math.random().toString(36).slice(2)}`;
    generationAgentEventHub.publish(jobId, startedEvent('n1', 'requirement-analyzer'));
    generationAgentEventHub.publish(jobId, startedEvent('n2', 'outline-generator'));

    const received: GenerationAgentEvent[] = [];
    const unsubscribe = generationAgentEventHub.subscribe(jobId, (e) => received.push(e));

    // Replay is synchronous during subscribe().
    expect(received).toHaveLength(2);
    expect((received[0] as { nodeId: string }).nodeId).toBe('n1');
    expect((received[1] as { nodeId: string }).nodeId).toBe('n2');

    unsubscribe();
  });

  it('multi-subscriber delivers independently', () => {
    const jobId = `multi-${Math.random().toString(36).slice(2)}`;
    const a: GenerationAgentEvent[] = [];
    const b: GenerationAgentEvent[] = [];
    const offA = generationAgentEventHub.subscribe(jobId, (e) => a.push(e));
    const offB = generationAgentEventHub.subscribe(jobId, (e) => b.push(e));

    generationAgentEventHub.publish(jobId, startedEvent('n1', 'requirement-analyzer'));

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);

    offA();
    offB();
  });
});
