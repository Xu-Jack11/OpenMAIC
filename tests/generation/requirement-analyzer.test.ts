import { describe, expect, it, vi } from 'vitest';

import { analyzeRequirement } from '@/lib/generation/requirement-analyzer';
import type { RequirementAnalysis } from '@/lib/generation/requirement-analyzer';
import type { AICallFn } from '@/lib/generation/pipeline-types';

/**
 * These tests exercise the analyzer's iteration wiring end-to-end with a
 * mocked aiCall: they distinguish the two LLM roles (draft generator vs judge)
 * by inspecting the incoming system prompt for the judge template's
 * "Requirement Analysis Judge" signature.
 */

const VALID_DRAFT: RequirementAnalysis = {
  topic: 'Linear algebra for ML engineers',
  subTopics: ['vector spaces', 'matrix decomposition', 'eigenvalues'],
  audience: 'intermediate',
  audienceDescription: 'ML engineers comfortable with Python',
  depth: 'working-knowledge',
  estimatedDurationMinutes: 30,
  style: 'hands-on',
  focusAreas: ['SVD', 'PCA'],
  prerequisites: ['Python basics', 'calculus intuition'],
  enrichedRequirement:
    'A working-knowledge, hands-on course for ML engineers covering vector spaces, matrix decomposition, eigenvalues, SVD and PCA, with Python-based exercises throughout.',
  ragQuery: 'SVD PCA matrix decomposition',
  referencedDocumentIds: ['doc-1'],
};

function draftReturningAiCall(responses: string[]): AICallFn & ReturnType<typeof vi.fn> {
  const queue = [...responses];
  const fn: AICallFn = async (systemPrompt: string) => {
    const isJudge = systemPrompt.includes('Requirement Analysis Judge');
    const next = queue.shift();
    if (next === undefined) {
      throw new Error(`Unexpected aiCall (isJudge=${isJudge}) with no queued response remaining`);
    }
    return next;
  };
  return vi.fn(fn) as AICallFn & ReturnType<typeof vi.fn>;
}

describe('analyzeRequirement with iteration', () => {
  it('accepts rule-passing draft when judge scores above threshold (single draft call)', async () => {
    const aiCall = draftReturningAiCall([
      JSON.stringify(VALID_DRAFT),
      JSON.stringify({ score: 92, issues: [], suggestions: [] }),
    ]);

    const result = await analyzeRequirement('linear algebra', 'en-US', aiCall, {
      availableDocuments: [{ id: 'doc-1', name: 'LA basics' }],
    });

    expect(result?.topic).toBe('Linear algebra for ML engineers');
    expect(aiCall).toHaveBeenCalledTimes(2);
  });

  it('revises when draft fails structural rule (short enrichedRequirement)', async () => {
    const bad = { ...VALID_DRAFT, enrichedRequirement: 'too short' };
    const aiCall = draftReturningAiCall([JSON.stringify(bad), JSON.stringify(VALID_DRAFT)]);

    const result = await analyzeRequirement('linear algebra', 'en-US', aiCall);

    expect(result?.enrichedRequirement).toBe(VALID_DRAFT.enrichedRequirement);
    expect(aiCall).toHaveBeenCalledTimes(2);
    const secondSystemPrompt = aiCall.mock.calls[1]?.[0] as string;
    expect(secondSystemPrompt).toContain('Critique of Previous Attempt');
    expect(secondSystemPrompt).toContain('enrichedRequirement');
  });

  it('revises when judge scores below threshold, with issues fed into critique', async () => {
    const aiCall = draftReturningAiCall([
      JSON.stringify(VALID_DRAFT),
      JSON.stringify({
        score: 55,
        issues: ['topic too broad'],
        suggestions: ['narrow to eigenvalue decomposition'],
      }),
      JSON.stringify({ ...VALID_DRAFT, topic: 'Eigenvalue decomposition deep-dive' }),
    ]);

    const result = await analyzeRequirement('linear algebra', 'en-US', aiCall);

    expect(result?.topic).toBe('Eigenvalue decomposition deep-dive');
    expect(aiCall).toHaveBeenCalledTimes(3);
    const reviseSystemPrompt = aiCall.mock.calls[2]?.[0] as string;
    expect(reviseSystemPrompt).toContain('Quality issues');
    expect(reviseSystemPrompt).toContain('topic too broad');
    expect(reviseSystemPrompt).toContain('narrow to eigenvalue decomposition');
  });

  it('rule gate flags verbatim-copy ragQuery when documents are provided', async () => {
    const requirement = 'teach me about SVD';
    const copyDraft = { ...VALID_DRAFT, ragQuery: requirement };
    const aiCall = draftReturningAiCall([JSON.stringify(copyDraft), JSON.stringify(VALID_DRAFT)]);

    const result = await analyzeRequirement(requirement, 'en-US', aiCall, {
      availableDocuments: [{ id: 'doc-1', name: 'SVD' }],
    });

    expect(result?.ragQuery).toBe('SVD PCA matrix decomposition');
    expect(aiCall).toHaveBeenCalledTimes(2);
    const revisePrompt = aiCall.mock.calls[1]?.[0] as string;
    expect(revisePrompt).toContain('verbatim copy');
  });

  it('falls back to draft when revision also fails rules', async () => {
    const bad1 = { ...VALID_DRAFT, topic: '' };
    const bad2 = { ...VALID_DRAFT, audience: 'kids' as never };
    const aiCall = draftReturningAiCall([JSON.stringify(bad1), JSON.stringify(bad2)]);

    const result = await analyzeRequirement('x', 'en-US', aiCall);

    // Revision also fails rules → fall back to original draft.
    expect(result).not.toBeNull();
    expect(result?.topic).toBe('');
    expect(aiCall).toHaveBeenCalledTimes(2);
  });

  it('skips iteration entirely when options.iteration.enabled is false', async () => {
    const aiCall = draftReturningAiCall([JSON.stringify(VALID_DRAFT)]);

    const result = await analyzeRequirement('linear algebra', 'en-US', aiCall, {
      iteration: { enabled: false },
    });

    expect(result?.topic).toBe('Linear algebra for ML engineers');
    expect(aiCall).toHaveBeenCalledTimes(1);
  });

  it('returns null when the first draft aiCall fails to produce a parseable analysis', async () => {
    const aiCall = draftReturningAiCall(['not-json-at-all']);
    const result = await analyzeRequirement('x', 'en-US', aiCall);
    expect(result).toBeNull();
    expect(aiCall).toHaveBeenCalledTimes(1);
  });
});
