/**
 * Unit tests for the agent artifact helpers.
 *
 * Targets the pure parts: `outlinesToMarkdown` formatting and `emitArtifact`
 * event emission. Dexie writes fail silently in a Node test environment (no
 * IndexedDB), which is deliberately tolerated by the helper — we assert the
 * SSE event is still emitted on the tree.
 */

import { describe, it, expect } from 'vitest';
import { emitArtifact, outlinesToMarkdown } from '@/lib/generation/agent/artifacts';
import { ActivityTree } from '@/lib/generation/agent/runtime';
import type { GenerationAgentEvent } from '@/lib/generation/agent/events';
import type { SceneOutline } from '@/lib/types/generation';

function stubOutlines(): SceneOutline[] {
  return [
    {
      id: 'o1',
      type: 'slide',
      title: 'Intro to Photosynthesis',
      description: 'Why plants need sunlight',
      keyPoints: ['Light reaction', 'Calvin cycle'],
      teachingObjective: 'Explain the two phases',
      estimatedDuration: 300,
      order: 0,
    },
    {
      id: 'o2',
      type: 'quiz',
      title: 'Check your understanding',
      description: 'Short quiz',
      keyPoints: ['q1', 'q2'],
      order: 1,
    },
  ];
}

describe('outlinesToMarkdown', () => {
  it('renders zh-CN headings and bullets', () => {
    const md = outlinesToMarkdown(stubOutlines(), 'zh-CN');
    expect(md).toContain('# 课程大纲');
    expect(md).toContain('## 1. Intro to Photosynthesis');
    expect(md).toContain('- **类型**: 讲解幻灯片');
    expect(md).toContain('**要点:**');
    expect(md).toContain('- Light reaction');
    expect(md).toContain('## 2. Check your understanding');
  });

  it('renders en-US labels when locale is en-US', () => {
    const md = outlinesToMarkdown(stubOutlines(), 'en-US');
    expect(md).toContain('# Course Outline');
    expect(md).toContain('**Type**: Slide');
    expect(md).toContain('**Type**: Quiz');
    expect(md).toContain('**Key points:**');
  });

  it('honors explicit title override', () => {
    const md = outlinesToMarkdown([], 'en-US', 'Custom Title');
    expect(md.startsWith('# Custom Title')).toBe(true);
  });
});

describe('emitArtifact', () => {
  it('emits an agent.artifact_created event carrying a preview + byte size', async () => {
    const tree = new ActivityTree();
    const seen: GenerationAgentEvent[] = [];
    tree.addListener((e) => seen.push(e));

    const markdown = 'hello world ' + 'x'.repeat(500);
    await emitArtifact(tree, {
      stageId: 'stage-1',
      artifactId: 'experiment-report',
      kind: 'document',
      title: 'Experiment Report',
      markdown,
    });

    const event = seen.find((e) => e.type === 'agent.artifact_created');
    expect(event).toBeDefined();
    if (event?.type !== 'agent.artifact_created') throw new Error('wrong type');
    expect(event.stageId).toBe('stage-1');
    expect(event.artifactId).toBe('experiment-report');
    expect(event.kind).toBe('document');
    expect(event.title).toBe('Experiment Report');
    expect(event.byteSize).toBe(markdown.length);
    expect((event.markdownPreview ?? '').length).toBeLessThanOrEqual(200);
    expect(event.markdownPreview?.startsWith('hello world')).toBe(true);
  });
});
