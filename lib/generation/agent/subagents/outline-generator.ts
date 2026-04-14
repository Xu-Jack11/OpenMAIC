/**
 * Subagent: outline-generator
 *
 * Wraps `generateSceneOutlinesFromRequirements` (Stage 1). The wrapped
 * function already performs self-iteration with judge-guided revise; that
 * iteration is hidden from the orchestrator's activity tree per Phase A.
 */

import { generateSceneOutlinesFromRequirements } from '@/lib/generation/outline-generator';
import type { UserRequirements } from '@/lib/types/generation';
import type { SubagentContext, SubagentDefinition } from '../types';
import type { GenerationAgentEvent } from '../events';
import {
  outlineGeneratorInputSchema,
  outlineGeneratorOutputSchema,
  type OutlineGeneratorInput,
  type OutlineGeneratorOutput,
} from '../schemas';

export const outlineGeneratorSubagent: SubagentDefinition<
  OutlineGeneratorInput,
  OutlineGeneratorOutput
> = {
  id: 'outline-generator',
  label: 'Outline generator',
  description:
    'Turns the enriched requirement and optional contexts (PDF, web research, RAG) into an ordered list of scene outlines with titles, key points, and speaker notes.',
  inputSchema: outlineGeneratorInputSchema,
  outputSchema: outlineGeneratorOutputSchema,
  timeoutMs: 300000,
  async *run(
    input: OutlineGeneratorInput,
    ctx: SubagentContext,
  ): AsyncGenerator<GenerationAgentEvent, OutlineGeneratorOutput, void> {
    yield {
      type: 'agent.thinking',
      nodeId: ctx.nodeId,
      stage: 'generate-outlines',
    };

    const requirements: UserRequirements = {
      requirement: input.requirement,
      language: input.language,
    };

    const result = await generateSceneOutlinesFromRequirements(
      requirements,
      input.pdfText,
      undefined,
      ctx.aiCall,
      undefined,
      {
        imageGenerationEnabled: input.imageGenerationEnabled,
        videoGenerationEnabled: input.videoGenerationEnabled,
        researchContext: input.researchContext,
        teacherContext: input.teacherContext,
        documentContext: input.documentContext,
      },
    );

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to generate scene outlines');
    }

    return { outlines: result.data };
  },
};
