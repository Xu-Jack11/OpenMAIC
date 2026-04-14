/**
 * Subagent: requirement-analyzer
 *
 * Wraps `analyzeRequirement` (Stage 0) without altering behavior. The wrapped
 * function already performs self-iteration with judge-guided revise; that
 * iteration is hidden from the orchestrator's activity tree per Phase A.
 */

import { analyzeRequirement } from '@/lib/generation/requirement-analyzer';
import type { SubagentContext, SubagentDefinition } from '../types';
import type { GenerationAgentEvent } from '../events';
import {
  requirementAnalyzerInputSchema,
  requirementAnalyzerOutputSchema,
  type RequirementAnalyzerInput,
  type RequirementAnalyzerOutput,
} from '../schemas';

export const requirementAnalyzerSubagent: SubagentDefinition<
  RequirementAnalyzerInput,
  RequirementAnalyzerOutput
> = {
  id: 'requirement-analyzer',
  label: 'Requirement analyzer',
  description:
    'Enriches the raw user requirement: extracts topic, audience, depth, focus areas, a focused RAG query, and referenced document ids.',
  inputSchema: requirementAnalyzerInputSchema,
  outputSchema: requirementAnalyzerOutputSchema,
  timeoutMs: 180000,
  async *run(
    input: RequirementAnalyzerInput,
    ctx: SubagentContext,
  ): AsyncGenerator<GenerationAgentEvent, RequirementAnalyzerOutput, void> {
    yield {
      type: 'agent.thinking',
      nodeId: ctx.nodeId,
      stage: 'analyze-requirement',
    };

    const analysis = await analyzeRequirement(input.requirement, input.language, ctx.aiCall, {
      pdfContent: input.pdfContent,
      researchContext: input.researchContext,
      availableDocuments: input.availableDocuments,
    });

    return analysis;
  },
};
