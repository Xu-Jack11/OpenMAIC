/**
 * Unit tests for subagent Zod input schemas.
 */

import { describe, expect, it } from 'vitest';
import {
  outlineGeneratorInputSchema,
  ragRetrieverInputSchema,
  requirementAnalyzerInputSchema,
  sceneActionGeneratorInputSchema,
  sceneComposerInputSchema,
  sceneContentGeneratorInputSchema,
  ttsGeneratorInputSchema,
  webResearcherInputSchema,
} from '@/lib/generation/agent/schemas';
import { generationAgentEventSchema } from '@/lib/generation/agent/events';

describe('subagent input schemas', () => {
  it('accepts a valid requirement-analyzer input', () => {
    const parsed = requirementAnalyzerInputSchema.safeParse({
      requirement: 'Teach stochastic gradient descent',
      language: 'zh-CN',
      pdfContent: 'some pdf text',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects non-zh-CN/en-US languages', () => {
    const parsed = requirementAnalyzerInputSchema.safeParse({
      requirement: 'x',
      language: 'fr-FR',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts an outline-generator input with optional contexts', () => {
    const parsed = outlineGeneratorInputSchema.safeParse({
      requirement: 'x',
      language: 'en-US',
      researchContext: 'web ctx',
      teacherContext: 'teacher',
      documentContext: 'rag ctx',
    });
    expect(parsed.success).toBe(true);
  });

  it('requires a non-empty query for the RAG retriever', () => {
    const bad = ragRetrieverInputSchema.safeParse({
      courseId: 'c1',
      query: '',
    });
    expect(bad.success).toBe(false);
  });

  it('accepts scene-content / scene-action / scene-composer inputs with object pass-throughs', () => {
    const outline = { id: 'o1', title: 'Scene', type: 'slide', keyPoints: [] };
    const content = { elements: [] };
    const actions = [{ type: 'speech', agentId: 'a1', text: 'hi' }];
    const agents = [{ id: 'a1', name: 'T', role: 'teacher' }];

    expect(sceneContentGeneratorInputSchema.safeParse({ outline, agents }).success).toBe(true);
    expect(sceneActionGeneratorInputSchema.safeParse({ outline, content, agents }).success).toBe(
      true,
    );
    expect(sceneComposerInputSchema.safeParse({ outline, content, actions }).success).toBe(true);
  });

  it('requires at least one scene for the TTS generator', () => {
    expect(
      ttsGeneratorInputSchema.safeParse({ scenes: [], stageId: 's', baseUrl: 'http://x' }).success,
    ).toBe(false);
  });

  it('rejects web-researcher input without an api key', () => {
    expect(webResearcherInputSchema.safeParse({ requirement: 'x', apiKey: '' }).success).toBe(
      false,
    );
  });
});

describe('generationAgentEventSchema', () => {
  it('round-trips every event type', () => {
    const events = [
      {
        type: 'agent.started',
        nodeId: 'n1',
        parentId: null,
        subagentId: 'requirement-analyzer',
        label: 'Requirement',
      },
      { type: 'agent.thinking', nodeId: 'n1' },
      {
        type: 'agent.tool_call',
        nodeId: 'n1',
        toolCallId: 'tc1',
        toolName: 'tavily.search',
      },
      {
        type: 'agent.tool_result',
        nodeId: 'n1',
        toolCallId: 'tc1',
        toolName: 'tavily.search',
        ok: true,
      },
      { type: 'agent.text_delta', nodeId: 'n1', delta: 'hello' },
      {
        type: 'agent.progress',
        pct: 50,
        message: 'working',
      },
      { type: 'agent.completed', nodeId: 'n1' },
      { type: 'agent.failed', nodeId: 'n1', error: 'boom' },
      { type: 'agent.checkpoint', nodeId: 'n1', key: 'outline-generator' },
      { type: 'classroom.done', classroomId: 'c1', url: '/c', scenesCount: 3 },
    ] as const;

    for (const ev of events) {
      const parsed = generationAgentEventSchema.safeParse(ev);
      expect(parsed.success, `Failed for ${ev.type}: ${JSON.stringify(parsed)}`).toBe(true);
    }
  });
});
