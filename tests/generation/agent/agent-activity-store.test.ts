/**
 * Unit tests for the agent-activity Zustand store.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { useAgentActivityStore, selectChildren } from '@/lib/store/agent-activity';

describe('useAgentActivityStore', () => {
  beforeEach(() => {
    useAgentActivityStore.getState().reset();
  });

  it('builds a tree from agent.started events', () => {
    const store = useAgentActivityStore.getState();
    store.applyEvent({
      type: 'agent.started',
      nodeId: 'root',
      parentId: null,
      subagentId: 'requirement-analyzer',
      label: 'Requirement',
    });
    store.applyEvent({
      type: 'agent.started',
      nodeId: 'child',
      parentId: 'root',
      subagentId: 'rag-retriever',
      label: 'RAG',
    });

    const state = useAgentActivityStore.getState();
    expect(state.rootIds).toEqual(['root']);
    expect(state.nodes.root?.children).toEqual(['child']);
    expect(selectChildren(state, 'root')).toHaveLength(1);
  });

  it('marks nodes as succeeded/failed on terminal events', () => {
    const store = useAgentActivityStore.getState();
    store.applyEvent({
      type: 'agent.started',
      nodeId: 'a',
      parentId: null,
      subagentId: 'outline-generator',
      label: 'Outline',
    });
    store.applyEvent({
      type: 'agent.completed',
      nodeId: 'a',
      outputSummary: '7 outlines',
    });

    expect(useAgentActivityStore.getState().nodes.a?.status).toBe('succeeded');
    expect(useAgentActivityStore.getState().nodes.a?.outputSummary).toBe('7 outlines');
  });

  it('appends tool calls and updates their status', () => {
    const store = useAgentActivityStore.getState();
    store.applyEvent({
      type: 'agent.started',
      nodeId: 'a',
      parentId: null,
      subagentId: 'web-researcher',
      label: 'Research',
    });
    store.applyEvent({
      type: 'agent.tool_call',
      nodeId: 'a',
      toolCallId: 'tc1',
      toolName: 'tavily.search',
      argsPreview: 'quantum mechanics',
    });
    store.applyEvent({
      type: 'agent.tool_result',
      nodeId: 'a',
      toolCallId: 'tc1',
      toolName: 'tavily.search',
      ok: true,
      summary: '5 sources',
    });

    const node = useAgentActivityStore.getState().nodes.a!;
    expect(node.toolCalls).toHaveLength(1);
    expect(node.toolCalls[0].status).toBe('succeeded');
    expect(node.toolCalls[0].resultSummary).toBe('5 sources');
  });

  it('accumulates text deltas bounded by 500 chars', () => {
    const store = useAgentActivityStore.getState();
    store.applyEvent({
      type: 'agent.started',
      nodeId: 'a',
      parentId: null,
      subagentId: 'scene-action-generator',
      label: 'Actions',
    });
    for (let i = 0; i < 120; i++) {
      store.applyEvent({
        type: 'agent.text_delta',
        nodeId: 'a',
        delta: '0123456789',
      });
    }
    const preview = useAgentActivityStore.getState().nodes.a?.textPreview;
    expect(preview?.length).toBeLessThanOrEqual(500);
  });

  it('records classroomResult on classroom.done', () => {
    const store = useAgentActivityStore.getState();
    store.applyEvent({
      type: 'classroom.done',
      classroomId: 'cls-1',
      url: '/classrooms/cls-1',
      scenesCount: 7,
    });
    expect(useAgentActivityStore.getState().classroomResult).toEqual({
      classroomId: 'cls-1',
      url: '/classrooms/cls-1',
      scenesCount: 7,
    });
  });
});
