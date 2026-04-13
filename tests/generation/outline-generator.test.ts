import { describe, expect, it, vi } from 'vitest';

import { generateSceneOutlinesFromRequirements } from '@/lib/generation/outline-generator';
import type { AICallFn } from '@/lib/generation/pipeline-types';
import type { SceneOutline, UserRequirements } from '@/lib/types/generation';

const REQ: UserRequirements = {
  requirement: 'Teach me the Fourier transform',
  language: 'en-US',
};

function makeOutline(partial: Partial<SceneOutline>, index: number): SceneOutline {
  return {
    id: `scene-${index}`,
    type: 'slide',
    title: `Scene ${index}`,
    description: `Describes scene ${index}`,
    keyPoints: ['Key A', 'Key B'],
    order: index,
    ...partial,
  };
}

const GOOD_OUTLINES: SceneOutline[] = [
  makeOutline({ title: 'Intro to Fourier' }, 1),
  makeOutline({ title: 'Time vs Frequency Domain', type: 'slide' }, 2),
  makeOutline({ title: 'Hands-on DFT', type: 'interactive' }, 3),
];

function queuedAiCall(responses: string[]): AICallFn & ReturnType<typeof vi.fn> {
  const queue = [...responses];
  const fn: AICallFn = async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('aiCall exhausted');
    return next;
  };
  return vi.fn(fn) as AICallFn & ReturnType<typeof vi.fn>;
}

describe('generateSceneOutlinesFromRequirements with iteration', () => {
  it('accepts first draft when rules pass and judge scores high', async () => {
    const aiCall = queuedAiCall([
      JSON.stringify(GOOD_OUTLINES),
      JSON.stringify({ score: 90, issues: [], suggestions: [] }),
    ]);

    const result = await generateSceneOutlinesFromRequirements(
      REQ,
      undefined,
      undefined,
      aiCall,
      undefined,
      undefined,
    );

    expect(result.success).toBe(true);
    expect(result.data?.length).toBe(3);
    expect(aiCall).toHaveBeenCalledTimes(2);
  });

  it('revises when rule gate flags duplicate titles', async () => {
    const dup = [
      makeOutline({ title: 'Intro' }, 1),
      makeOutline({ title: 'Intro' }, 2),
      makeOutline({ title: 'Deep-dive' }, 3),
    ];
    const aiCall = queuedAiCall([JSON.stringify(dup), JSON.stringify(GOOD_OUTLINES)]);

    const result = await generateSceneOutlinesFromRequirements(
      REQ,
      undefined,
      undefined,
      aiCall,
      undefined,
      undefined,
    );

    expect(result.success).toBe(true);
    expect(result.data?.map((o) => o.title)).toEqual([
      'Intro to Fourier',
      'Time vs Frequency Domain',
      'Hands-on DFT',
    ]);
    expect(aiCall).toHaveBeenCalledTimes(2);
  });

  it('revises when rule gate flags invalid scene type', async () => {
    const invalid = [
      makeOutline({ title: 'A', type: 'video' as never }, 1),
      makeOutline({ title: 'B' }, 2),
    ];
    const aiCall = queuedAiCall([JSON.stringify(invalid), JSON.stringify(GOOD_OUTLINES)]);

    const result = await generateSceneOutlinesFromRequirements(
      REQ,
      undefined,
      undefined,
      aiCall,
      undefined,
      undefined,
    );

    expect(result.success).toBe(true);
    expect(result.data?.length).toBe(3);
    expect(aiCall).toHaveBeenCalledTimes(2);
  });

  it('revises when judge scores below threshold', async () => {
    const aiCall = queuedAiCall([
      JSON.stringify(GOOD_OUTLINES),
      JSON.stringify({ score: 55, issues: ['vague keyPoints'], suggestions: ['be specific'] }),
      JSON.stringify(GOOD_OUTLINES),
    ]);

    const result = await generateSceneOutlinesFromRequirements(
      REQ,
      undefined,
      undefined,
      aiCall,
      undefined,
      undefined,
    );

    expect(result.success).toBe(true);
    expect(aiCall).toHaveBeenCalledTimes(3);
  });

  it('rule gate enforces RAG term coverage when documentContext is present', async () => {
    // documentContext features "fourier" and "spectrum" repeatedly as
    // signature terms. First draft talks about neither → rule-fail → revise.
    const documentContext =
      'Fourier analysis fourier theory the fourier transform. spectrum analysis reveals spectrum components. fourier spectrum fourier spectrum sampling sampling theorem. sampling theorem sampling theorem.';
    const offTopic = [
      makeOutline({ title: 'Intro to calculus', keyPoints: ['limits', 'integrals'] }, 1),
      makeOutline({ title: 'Vector fields', keyPoints: ['gradients', 'divergence'] }, 2),
    ];
    const onTopic = [
      makeOutline(
        {
          title: 'Fourier transform basics',
          description: 'Intro to fourier spectrum analysis',
          keyPoints: ['fourier transform', 'spectrum', 'sampling theorem'],
        },
        1,
      ),
      makeOutline(
        {
          title: 'Sampling and spectrum',
          description: 'Nyquist sampling and fourier spectrum',
          keyPoints: ['sampling rate', 'fourier spectrum', 'aliasing'],
        },
        2,
      ),
    ];
    const aiCall = queuedAiCall([JSON.stringify(offTopic), JSON.stringify(onTopic)]);

    const result = await generateSceneOutlinesFromRequirements(
      REQ,
      undefined,
      undefined,
      aiCall,
      undefined,
      { documentContext },
    );

    expect(result.success).toBe(true);
    expect(result.data?.[0]?.title).toBe('Fourier transform basics');
    expect(aiCall).toHaveBeenCalledTimes(2);
  });

  it('skips iteration entirely when options.iteration.enabled is false', async () => {
    const aiCall = queuedAiCall([JSON.stringify(GOOD_OUTLINES)]);

    const result = await generateSceneOutlinesFromRequirements(
      REQ,
      undefined,
      undefined,
      aiCall,
      undefined,
      { iteration: { enabled: false } },
    );

    expect(result.success).toBe(true);
    expect(aiCall).toHaveBeenCalledTimes(1);
  });

  it('returns success=false error when draft returns empty array', async () => {
    const aiCall = queuedAiCall(['[]']);
    const result = await generateSceneOutlinesFromRequirements(
      REQ,
      undefined,
      undefined,
      aiCall,
      undefined,
      { iteration: { enabled: false } },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to parse');
  });
});
