import { describe, expect, it, vi } from 'vitest';

import {
  iterateWithCritique,
  formatCritiqueForPrompt,
  type CritiqueFeedback,
  type IterationConfig,
  type JudgeResult,
  type RuleCheckResult,
} from '@/lib/generation/iteration';

type Draft = { text: string; marker: string };

function buildConfig(overrides: Partial<IterationConfig<Draft>>): IterationConfig<Draft> {
  return {
    node: 'test',
    generate: vi.fn(async () => ({ text: 'default', marker: 'A' })),
    ruleCheck: vi.fn((): RuleCheckResult => ({ passed: true, violations: [] })),
    ...overrides,
  };
}

describe('iterateWithCritique', () => {
  it('returns draft without judge when iteration is disabled', async () => {
    const generate = vi.fn(async () => ({ text: 'single', marker: 'A' }));
    const judge = vi.fn<(draft: Draft) => Promise<JudgeResult>>();
    const cfg = buildConfig({
      generate,
      judge,
      options: { enabled: false },
    });

    const result = await iterateWithCritique(cfg);

    expect(result).toEqual({ text: 'single', marker: 'A' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(null);
    expect(judge).not.toHaveBeenCalled();
  });

  it('returns null when first generate returns null', async () => {
    const generate = vi.fn(async () => null);
    const cfg = buildConfig({ generate });

    const result = await iterateWithCritique(cfg);
    expect(result).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('accepts draft on attempt 1 when rule passes and judge scores above threshold', async () => {
    const generate = vi.fn(async () => ({ text: 'draft1', marker: 'A' }));
    const judge = vi.fn(async () => ({ score: 92, issues: [], suggestions: [] }));
    const cfg = buildConfig({
      generate,
      judge,
      options: { qualityThreshold: 80 },
    });

    const result = await iterateWithCritique(cfg);

    expect(result).toEqual({ text: 'draft1', marker: 'A' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it('skips judge and revises when rule gate fails on draft', async () => {
    const drafts: Draft[] = [
      { text: 'bad-draft', marker: 'A' },
      { text: 'fixed', marker: 'B' },
    ];
    const generate = vi.fn(async () => drafts.shift()!);
    const ruleCheck = vi
      .fn<(draft: Draft) => RuleCheckResult>()
      .mockImplementationOnce(() => ({ passed: false, violations: ['topic missing'] }))
      .mockImplementationOnce(() => ({ passed: true, violations: [] }));
    const judge = vi.fn<(draft: Draft) => Promise<JudgeResult>>();

    const result = await iterateWithCritique(buildConfig({ generate, ruleCheck, judge }));

    expect(result).toEqual({ text: 'fixed', marker: 'B' });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(judge).not.toHaveBeenCalled();
    const secondCallArg = (generate.mock.calls as unknown[][])[1]?.[0] as CritiqueFeedback;
    expect(secondCallArg.violations).toEqual(['topic missing']);
    expect(secondCallArg.issues).toEqual([]);
  });

  it('revises when rule passes but judge below threshold, feeds issues back', async () => {
    const drafts: Draft[] = [
      { text: 'draft1', marker: 'A' },
      { text: 'draft2', marker: 'B' },
    ];
    const generate = vi.fn(async () => drafts.shift()!);
    const judge = vi.fn(async () => ({
      score: 55,
      issues: ['too vague'],
      suggestions: ['add specifics'],
    }));

    const result = await iterateWithCritique(
      buildConfig({ generate, judge, options: { qualityThreshold: 80 } }),
    );

    expect(result).toEqual({ text: 'draft2', marker: 'B' });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(judge).toHaveBeenCalledTimes(1);
    const critique = (generate.mock.calls as unknown[][])[1]?.[0] as CritiqueFeedback;
    expect(critique.issues).toEqual(['too vague']);
    expect(critique.suggestions).toEqual(['add specifics']);
    expect(critique.violations).toEqual([]);
  });

  it('falls back to original draft when revision fails rule gate', async () => {
    const drafts: Draft[] = [
      { text: 'draft1', marker: 'A' },
      { text: 'draft2-broken', marker: 'X' },
    ];
    const generate = vi.fn(async () => drafts.shift()!);
    const ruleCheck = vi
      .fn<(draft: Draft) => RuleCheckResult>()
      .mockImplementationOnce(() => ({ passed: true, violations: [] }))
      .mockImplementationOnce(() => ({ passed: false, violations: ['broke structure'] }));
    const judge = vi.fn(async () => ({ score: 50, issues: ['weak'], suggestions: [] }));

    const result = await iterateWithCritique(buildConfig({ generate, ruleCheck, judge }));

    expect(result).toEqual({ text: 'draft1', marker: 'A' });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('falls back to original draft when revision returns null', async () => {
    const results: Array<Draft | null> = [{ text: 'draft1', marker: 'A' }, null];
    const generate = vi.fn(async () => results.shift()!);
    const judge = vi.fn(async () => ({ score: 50, issues: [], suggestions: [] }));

    const result = await iterateWithCritique(buildConfig({ generate, judge }));

    expect(result).toEqual({ text: 'draft1', marker: 'A' });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('hard-caps attempts at 2 even when callers request more', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ text: 'a', marker: '1' })
      .mockResolvedValueOnce({ text: 'b', marker: '2' })
      .mockResolvedValueOnce({ text: 'c', marker: '3' });
    const judge = vi.fn(async () => ({ score: 10, issues: [], suggestions: [] }));

    const result = await iterateWithCritique(
      buildConfig({ generate, judge, options: { maxIterations: 5 } }),
    );

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result?.marker).toBe('2');
  });

  it('accepts rule-passing draft when judge is omitted', async () => {
    const generate = vi.fn(async () => ({ text: 'ok', marker: 'A' }));

    const result = await iterateWithCritique(buildConfig({ generate }));

    expect(result).toEqual({ text: 'ok', marker: 'A' });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('treats a throwing judge as score 0 and revises', async () => {
    const drafts: Draft[] = [
      { text: 'draft1', marker: 'A' },
      { text: 'draft2', marker: 'B' },
    ];
    const generate = vi.fn(async () => drafts.shift()!);
    const judge = vi.fn(async () => {
      throw new Error('judge down');
    });

    const result = await iterateWithCritique(buildConfig({ generate, judge }));

    expect(result).toEqual({ text: 'draft2', marker: 'B' });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('clamps out-of-range judge scores to [0, 100]', async () => {
    const generate = vi.fn(async () => ({ text: 'draft1', marker: 'A' }));
    const judge = vi.fn(async () => ({ score: 999, issues: [], suggestions: [] }));

    const result = await iterateWithCritique(
      buildConfig({ generate, judge, options: { qualityThreshold: 80 } }),
    );

    // Clamped to 100 → passes threshold → accepts draft 1, no revise.
    expect(result).toEqual({ text: 'draft1', marker: 'A' });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('emits onIterationStart with correct phase for each attempt', async () => {
    const drafts: Draft[] = [
      { text: 'a', marker: 'A' },
      { text: 'b', marker: 'B' },
    ];
    const generate = vi.fn(async () => drafts.shift()!);
    const judge = vi.fn(async () => ({ score: 40, issues: [], suggestions: [] }));
    const onIterationStart = vi.fn();

    await iterateWithCritique(buildConfig({ generate, judge, onIterationStart }));

    expect(onIterationStart).toHaveBeenCalledTimes(2);
    expect(onIterationStart).toHaveBeenNthCalledWith(1, 'draft');
    expect(onIterationStart).toHaveBeenNthCalledWith(2, 'revise');
  });
});

describe('formatCritiqueForPrompt', () => {
  it('returns empty string when critique is null', () => {
    expect(formatCritiqueForPrompt(null, 'zh-CN')).toBe('');
  });

  it('returns empty string when all critique arrays are empty', () => {
    expect(formatCritiqueForPrompt({ violations: [], issues: [], suggestions: [] }, 'en-US')).toBe(
      '',
    );
  });

  it('includes violations, issues, and suggestions sections in zh-CN', () => {
    const out = formatCritiqueForPrompt(
      {
        violations: ['missing topic'],
        issues: ['too vague'],
        suggestions: ['add specifics'],
      },
      'zh-CN',
    );
    expect(out).toContain('对上次输出的审视反馈');
    expect(out).toContain('结构/字段问题');
    expect(out).toContain('- missing topic');
    expect(out).toContain('质量问题');
    expect(out).toContain('- too vague');
    expect(out).toContain('改进建议');
    expect(out).toContain('- add specifics');
  });

  it('uses English headings for en-US language', () => {
    const out = formatCritiqueForPrompt(
      { violations: ['x'], issues: [], suggestions: [] },
      'en-US',
    );
    expect(out).toContain('Critique of Previous Attempt');
    expect(out).toContain('Structural violations');
  });

  it('omits sections that have no content', () => {
    const out = formatCritiqueForPrompt(
      { violations: [], issues: ['thin coverage'], suggestions: [] },
      'en-US',
    );
    expect(out).not.toContain('Structural violations');
    expect(out).toContain('Quality issues');
    expect(out).not.toContain('Improvement suggestions');
  });
});
