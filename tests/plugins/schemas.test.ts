/**
 * Unit tests for the Phase D plugin output Zod schemas.
 *
 * Round-trips plausible LLM responses for each built-in plugin and asserts
 * that obvious malformations are rejected with a useful message.
 */

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SCHEMA_IDS,
  experimentOutputSchema,
  getPluginOutputSchema,
  handoutOutputSchema,
  readingOutputSchema,
} from '@/lib/plugins/schemas';

describe('getPluginOutputSchema', () => {
  it('returns a schema for every built-in plugin id', () => {
    for (const id of BUILTIN_SCHEMA_IDS) {
      expect(getPluginOutputSchema(id)).not.toBeNull();
    }
  });

  it('returns null for unknown / user-defined skill ids', () => {
    expect(getPluginOutputSchema('custom-my-skill')).toBeNull();
    expect(getPluginOutputSchema('')).toBeNull();
  });
});

describe('handoutOutputSchema', () => {
  it('accepts a minimal valid response', () => {
    const parsed = handoutOutputSchema.safeParse({
      title: 'Photosynthesis Handout',
      overview: 'A refresher on light reactions.',
      summary: 'Key steps and products.',
      sections: [
        {
          type: 'slide',
          title: 'Overview',
          keyPoints: ['Chlorophyll absorbs light'],
          notes: '',
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('fills in defaults for missing optional list fields', () => {
    const parsed = handoutOutputSchema.safeParse({
      title: 'x',
      sections: [{ type: 'slide', title: 'a' }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.overview).toBe('');
      expect(parsed.data.summary).toBe('');
      expect(parsed.data.sections[0].keyPoints).toEqual([]);
    }
  });

  it('rejects empty sections array', () => {
    const parsed = handoutOutputSchema.safeParse({
      title: 'x',
      sections: [],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects invalid section type', () => {
    const parsed = handoutOutputSchema.safeParse({
      title: 'x',
      sections: [{ type: 'invalid', title: 'a' }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('experimentOutputSchema', () => {
  it('accepts a minimal valid response', () => {
    const parsed = experimentOutputSchema.safeParse({
      title: 'Gravity',
      subject: 'Physics',
      purpose: 'Measure gravitational acceleration',
      materials: [{ name: 'Ruler', quantity: '1' }],
      steps: [{ order: 1, instruction: 'Hold the ruler upright' }],
      safetyNotes: [],
      expectedResults: 'Approximately 9.8 m/s².',
      thinkingQuestions: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('requires at least one step', () => {
    const parsed = experimentOutputSchema.safeParse({
      title: 'x',
      subject: 's',
      purpose: 'p',
      materials: [],
      steps: [],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects negative step order', () => {
    const parsed = experimentOutputSchema.safeParse({
      title: 'x',
      subject: 's',
      purpose: 'p',
      steps: [{ order: -1, instruction: 'x' }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('readingOutputSchema', () => {
  it('accepts a minimal valid response with only title', () => {
    const parsed = readingOutputSchema.safeParse({ title: 'Quantum Entanglement' });
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid resource type', () => {
    const parsed = readingOutputSchema.safeParse({
      title: 'x',
      recommendedResources: [{ title: 'a', type: 'invalid', description: '' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts every valid resource type', () => {
    const parsed = readingOutputSchema.safeParse({
      title: 'x',
      recommendedResources: [
        { title: 'b1', type: 'book', description: '' },
        { title: 'a1', type: 'article', description: '' },
        { title: 'v1', type: 'video', description: '' },
        { title: 'w1', type: 'website', description: '' },
        { title: 'o1', type: 'other', description: '' },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
