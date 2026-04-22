/**
 * Plugin output Zod schemas (Phase D).
 *
 * Shape-validates LLM responses for built-in plugins. Keyed by the plugin's
 * stable `skillId` (e.g. `'handout'`, `'experiment'`, `'reading'`). The
 * skill API route uses `getPluginOutputSchema(skillId)` to pick a validator;
 * when no entry exists, validation is skipped to preserve backward
 * compatibility with user-defined YAML skills.
 *
 * Schemas intentionally mirror the TypeScript interfaces in
 * `lib/types/supplementary.ts`. Tighten these rather than adding new fields
 * inline — if the two diverge, the tests in
 * `tests/plugins/schemas.test.ts` will flag it.
 */

import { z } from 'zod';

/** Reusable fragment: a required non-empty string. */
const nonEmptyString = z.string().min(1);

// ----- Handout --------------------------------------------------------------

const handoutSectionSchema = z.object({
  type: z.enum(['slide', 'quiz', 'interactive', 'pbl']),
  title: nonEmptyString,
  keyPoints: z.array(z.string()).default([]),
  notes: z.string().default(''),
  questions: z
    .array(
      z.object({
        question: nonEmptyString,
        options: z.array(z.string()).optional(),
        answer: z.string().optional(),
        analysis: z.string().optional(),
      }),
    )
    .optional(),
});

export const handoutOutputSchema = z.object({
  title: nonEmptyString,
  overview: z.string().default(''),
  sections: z.array(handoutSectionSchema).min(1),
  summary: z.string().default(''),
});

// ----- Experiment design ----------------------------------------------------

const experimentMaterialSchema = z.object({
  name: nonEmptyString,
  quantity: nonEmptyString,
  notes: z.string().optional(),
});

const experimentStepSchema = z.object({
  order: z.number().int().nonnegative(),
  instruction: nonEmptyString,
  duration: z.string().optional(),
  tips: z.string().optional(),
});

export const experimentOutputSchema = z.object({
  title: nonEmptyString,
  subject: nonEmptyString,
  purpose: nonEmptyString,
  materials: z.array(experimentMaterialSchema).default([]),
  steps: z.array(experimentStepSchema).min(1),
  safetyNotes: z.array(z.string()).default([]),
  expectedResults: z.string().default(''),
  thinkingQuestions: z.array(z.string()).default([]),
});

// ----- Extended reading -----------------------------------------------------

const readingKnowledgePointSchema = z.object({
  title: nonEmptyString,
  content: nonEmptyString,
  connections: z.string().optional(),
});

const readingResourceSchema = z.object({
  title: nonEmptyString,
  type: z.enum(['book', 'article', 'video', 'website', 'other']),
  description: z.string().default(''),
  url: z.string().url().optional(),
});

export const readingOutputSchema = z.object({
  title: nonEmptyString,
  topicOverview: z.string().default(''),
  knowledgePoints: z.array(readingKnowledgePointSchema).default([]),
  recommendedResources: z.array(readingResourceSchema).default([]),
  guidingQuestions: z.array(z.string()).default([]),
});

// ----- Registry --------------------------------------------------------------

/**
 * Built-in plugin response schemas keyed by `skillId`. Kept loose with
 * `z.ZodTypeAny` so callers can validate without knowing the exact shape.
 */
const BUILTIN_OUTPUT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  handout: handoutOutputSchema,
  experiment: experimentOutputSchema,
  reading: readingOutputSchema,
};

/**
 * Returns the Zod output schema for a built-in plugin, or `null` if the
 * `skillId` is not a built-in (e.g. user YAML skill). Callers should treat
 * `null` as "skip validation".
 */
export function getPluginOutputSchema(skillId: string): z.ZodTypeAny | null {
  return BUILTIN_OUTPUT_SCHEMAS[skillId] ?? null;
}

/**
 * List of built-in plugin ids that have Zod schemas. Exported for drift
 * guards in tests.
 */
export const BUILTIN_SCHEMA_IDS = Object.keys(BUILTIN_OUTPUT_SCHEMAS) as readonly string[];
