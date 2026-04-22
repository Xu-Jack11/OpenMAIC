/**
 * Subagent: rag-retriever
 *
 * Wraps `buildDocumentContext` from the RAG module. In Phase A this is a leaf
 * subagent; Phase B will also expose it as a sub-tool callable by other
 * subagents.
 */

import { buildDocumentContext } from '@/lib/rag';
import type { SubagentContext, SubagentDefinition } from '../types';
import type { GenerationAgentEvent } from '../events';
import {
  ragRetrieverInputSchema,
  ragRetrieverOutputSchema,
  type RagRetrieverInput,
  type RagRetrieverOutput,
} from '../schemas';

export const ragRetrieverSubagent: SubagentDefinition<RagRetrieverInput, RagRetrieverOutput> = {
  id: 'rag-retriever',
  label: 'RAG retriever',
  description:
    'Retrieves relevant document chunks for a query from the course corpus (pgvector hybrid search) and formats them as prompt context.',
  inputSchema: ragRetrieverInputSchema,
  outputSchema: ragRetrieverOutputSchema,
  timeoutMs: 60000,
  async *run(
    input: RagRetrieverInput,
    ctx: SubagentContext,
  ): AsyncGenerator<GenerationAgentEvent, RagRetrieverOutput, void> {
    yield {
      type: 'agent.thinking',
      nodeId: ctx.nodeId,
      stage: 'rag-search',
    };

    const result = await buildDocumentContext({
      courseId: input.courseId,
      query: input.query,
      topK: input.topK ?? 8,
      maxTokens: input.maxTokens ?? 3000,
      documentIds: input.documentIds,
    });

    return result;
  },
};
