/**
 * Subagent: web-researcher
 *
 * Wraps the Tavily web search pipeline:
 *   requirement (+ optional pdfText) → searchQuery → searchWithTavily →
 *   formatSearchResultsAsContext
 *
 * Failure modes are non-fatal: the subagent returns `{ context: undefined,
 * sourcesCount: 0 }` so the orchestrator can keep going without web context.
 */

import { createLogger } from '@/lib/logger';
import { buildSearchQuery } from '@/lib/server/search-query-builder';
import { formatSearchResultsAsContext, searchWithTavily } from '@/lib/web-search/tavily';
import type { SubagentContext, SubagentDefinition } from '../types';
import type { GenerationAgentEvent } from '../events';
import {
  webResearcherInputSchema,
  webResearcherOutputSchema,
  type WebResearcherInput,
  type WebResearcherOutput,
} from '../schemas';

const log = createLogger('Subagent:WebResearcher');

export const webResearcherSubagent: SubagentDefinition<WebResearcherInput, WebResearcherOutput> = {
  id: 'web-researcher',
  label: 'Web researcher',
  description:
    'Rewrites the requirement into a focused search query and retrieves web results via Tavily, returning a formatted research-context string.',
  inputSchema: webResearcherInputSchema,
  outputSchema: webResearcherOutputSchema,
  timeoutMs: 60000,
  async *run(
    input: WebResearcherInput,
    ctx: SubagentContext,
  ): AsyncGenerator<GenerationAgentEvent, WebResearcherOutput, void> {
    yield {
      type: 'agent.thinking',
      nodeId: ctx.nodeId,
      stage: 'rewrite-query',
    };

    const queryAi = ctx.lightweightAiCall ?? ctx.aiCall;

    try {
      const searchQuery = await buildSearchQuery(input.requirement, input.pdfText, queryAi);

      yield {
        type: 'agent.tool_call',
        nodeId: ctx.nodeId,
        toolCallId: `${ctx.nodeId}:tavily`,
        toolName: 'tavily.search',
        argsPreview: searchQuery.query.slice(0, 140),
      };

      const searchResult = await searchWithTavily({
        query: searchQuery.query,
        apiKey: input.apiKey,
      });

      yield {
        type: 'agent.tool_result',
        nodeId: ctx.nodeId,
        toolCallId: `${ctx.nodeId}:tavily`,
        toolName: 'tavily.search',
        ok: true,
        summary: `${searchResult.sources.length} sources`,
      };

      const context = formatSearchResultsAsContext(searchResult);
      return {
        context: context || undefined,
        sourcesCount: searchResult.sources.length,
      };
    } catch (error) {
      log.warn('Web search failed, continuing without research context', error);
      return { context: undefined, sourcesCount: 0 };
    }
  },
};
