/**
 * Generation Agent — Zod Schemas (Phase A)
 *
 * Lightweight input/output schemas for each built-in subagent. These validate
 * the *boundary* between the orchestrator and the subagent — the heavy
 * structural types (SceneOutline, Scene, Action, GeneratedSlideContent, ...)
 * are re-exported from the existing type system via `z.custom<T>()` to avoid
 * duplicating deeply nested schemas in Phase A.
 *
 * Phase D will tighten these schemas into full structural validation.
 */

import { z } from 'zod';
import type { AgentInfo, GeneratedSlideData } from '@/lib/generation/pipeline-types';
import type { RequirementAnalysis } from '@/lib/generation/requirement-analyzer';
import type { DocumentContext } from '@/lib/rag/types';
import type { Scene, Stage } from '@/lib/types/stage';
import type { Action } from '@/lib/types/action';
import type {
  GeneratedInteractiveContent,
  GeneratedPBLContent,
  GeneratedQuizContent,
  GeneratedSlideContent,
  SceneOutline,
} from '@/lib/types/generation';

// ----- Generic pass-through (Phase A) ----------------------------------------

/** Pass-through schema for complex nominal types. */
export function passthrough<T>(label: string): z.ZodType<T> {
  return z.custom<T>(
    (val) => val !== null && (typeof val === 'object' || Array.isArray(val)),
    `Expected ${label}`,
  );
}

export const languageSchema = z.enum(['zh-CN', 'en-US']);
export const agentInfoSchema = passthrough<AgentInfo>('AgentInfo');
export const agentInfoArraySchema = z.array(agentInfoSchema);

// ----- Requirement analyzer --------------------------------------------------

export const requirementAnalyzerInputSchema = z.object({
  requirement: z.string().min(1),
  language: languageSchema,
  pdfContent: z.string().optional(),
  researchContext: z.string().optional(),
  availableDocuments: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});
export type RequirementAnalyzerInput = z.infer<typeof requirementAnalyzerInputSchema>;

export const requirementAnalyzerOutputSchema = passthrough<RequirementAnalysis | null>(
  'RequirementAnalysis',
);
export type RequirementAnalyzerOutput = RequirementAnalysis | null;

// ----- Web researcher --------------------------------------------------------

export const webResearcherInputSchema = z.object({
  requirement: z.string().min(1),
  pdfText: z.string().optional(),
  apiKey: z.string().min(1),
});
export type WebResearcherInput = z.infer<typeof webResearcherInputSchema>;

export const webResearcherOutputSchema = z.object({
  context: z.string().optional(),
  sourcesCount: z.number().int().min(0),
});
export type WebResearcherOutput = z.infer<typeof webResearcherOutputSchema>;

// ----- RAG retriever ---------------------------------------------------------

export const ragRetrieverInputSchema = z.object({
  courseId: z.string().min(1),
  query: z.string().min(1),
  topK: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  documentIds: z.array(z.string()).optional(),
});
export type RagRetrieverInput = z.infer<typeof ragRetrieverInputSchema>;

export const ragRetrieverOutputSchema = passthrough<DocumentContext | null>('DocumentContext');
export type RagRetrieverOutput = DocumentContext | null;

// ----- Outline generator -----------------------------------------------------

export const outlineGeneratorInputSchema = z.object({
  requirement: z.string().min(1),
  language: languageSchema,
  pdfText: z.string().optional(),
  researchContext: z.string().optional(),
  teacherContext: z.string().optional(),
  documentContext: z.string().optional(),
  imageGenerationEnabled: z.boolean().optional(),
  videoGenerationEnabled: z.boolean().optional(),
});
export type OutlineGeneratorInput = z.infer<typeof outlineGeneratorInputSchema>;

export const outlineGeneratorOutputSchema = z.object({
  outlines: z.array(passthrough<SceneOutline>('SceneOutline')).min(1),
});
export type OutlineGeneratorOutput = z.infer<typeof outlineGeneratorOutputSchema>;

// ----- Scene content generator -----------------------------------------------

export const sceneContentGeneratorInputSchema = z.object({
  outline: passthrough<SceneOutline>('SceneOutline'),
  agents: agentInfoArraySchema,
});
export type SceneContentGeneratorInput = z.infer<typeof sceneContentGeneratorInputSchema>;

export type SceneContentGeneratorOutput =
  | GeneratedSlideContent
  | GeneratedQuizContent
  | GeneratedInteractiveContent
  | GeneratedPBLContent
  | null;
export const sceneContentGeneratorOutputSchema =
  passthrough<SceneContentGeneratorOutput>('SceneContent');

// ----- Scene action generator ------------------------------------------------

export const sceneActionGeneratorInputSchema = z.object({
  outline: passthrough<SceneOutline>('SceneOutline'),
  content: passthrough<
    GeneratedSlideContent | GeneratedQuizContent | GeneratedInteractiveContent | GeneratedPBLContent
  >('SceneContent'),
  agents: agentInfoArraySchema,
});
export type SceneActionGeneratorInput = z.infer<typeof sceneActionGeneratorInputSchema>;

export const sceneActionGeneratorOutputSchema = z.object({
  actions: z.array(passthrough<Action>('Action')),
});
export type SceneActionGeneratorOutput = z.infer<typeof sceneActionGeneratorOutputSchema>;

// ----- Scene composer --------------------------------------------------------

export const sceneComposerInputSchema = z.object({
  outline: passthrough<SceneOutline>('SceneOutline'),
  content: passthrough<
    GeneratedSlideContent | GeneratedQuizContent | GeneratedInteractiveContent | GeneratedPBLContent
  >('SceneContent'),
  actions: z.array(passthrough<Action>('Action')),
});
export type SceneComposerInput = z.infer<typeof sceneComposerInputSchema>;

export const sceneComposerOutputSchema = z.object({
  sceneId: z.string().min(1).nullable(),
});
export type SceneComposerOutput = z.infer<typeof sceneComposerOutputSchema>;

// ----- Media generator -------------------------------------------------------

export const mediaGeneratorInputSchema = z.object({
  outlines: z.array(passthrough<SceneOutline>('SceneOutline')).min(1),
  stageId: z.string().min(1),
  baseUrl: z.string().min(1),
});
export type MediaGeneratorInput = z.infer<typeof mediaGeneratorInputSchema>;

export const mediaGeneratorOutputSchema = z.object({
  mediaCount: z.number().int().min(0),
});
export type MediaGeneratorOutput = z.infer<typeof mediaGeneratorOutputSchema>;

// ----- TTS generator ---------------------------------------------------------

export const ttsGeneratorInputSchema = z.object({
  scenes: z.array(passthrough<Scene>('Scene')).min(1),
  stageId: z.string().min(1),
  baseUrl: z.string().min(1),
});
export type TTSGeneratorInput = z.infer<typeof ttsGeneratorInputSchema>;

export const ttsGeneratorOutputSchema = z.object({
  ok: z.boolean(),
});
export type TTSGeneratorOutput = z.infer<typeof ttsGeneratorOutputSchema>;

// ----- Plugin runner ---------------------------------------------------------

export const pluginRunnerInputSchema = z.object({
  stage: passthrough<Stage>('Stage'),
  scenes: z.array(passthrough<Scene>('Scene')),
  locale: languageSchema,
  pluginIds: z.array(z.string()).optional(),
});
export type PluginRunnerInput = z.infer<typeof pluginRunnerInputSchema>;

export const pluginRunnerOutputSchema = z.object({
  executed: z.array(z.object({ id: z.string(), ok: z.boolean() })),
});
export type PluginRunnerOutput = z.infer<typeof pluginRunnerOutputSchema>;

// ----- Re-exported legacy slide data helper ---------------------------------

export const generatedSlideDataSchema = passthrough<GeneratedSlideData>('GeneratedSlideData');
