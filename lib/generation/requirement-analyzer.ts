/**
 * Requirement Analyzer
 *
 * Parses the user's free-form requirement via LLM to produce
 * a structured, enriched requirement for the outline generator.
 */

import { buildPrompt, PROMPT_IDS } from './prompts';
import { parseJsonResponse } from './json-repair';
import { MAX_PDF_CONTENT_CHARS } from '@/lib/constants/generation';
import type { AICallFn } from './pipeline-types';
import { createLogger } from '@/lib/logger';

const log = createLogger('RequirementAnalyzer');
const MAX_AVAILABLE_DOCS_IN_PROMPT = 30;

interface AvailableDocument {
  id: string;
  name: string;
}

export interface RequirementAnalysis {
  topic: string;
  subTopics: string[];
  audience: 'beginner' | 'intermediate' | 'advanced';
  audienceDescription: string;
  depth: 'overview' | 'working-knowledge' | 'deep-dive';
  estimatedDurationMinutes: number;
  style: 'lecture' | 'hands-on' | 'discussion' | 'case-study' | 'mixed';
  focusAreas: string[];
  prerequisites: string[];
  enrichedRequirement: string;
  ragQuery: string;
  referencedDocumentIds: string[];
}

/**
 * Analyze a raw requirement and return a structured, enriched version.
 * Falls back to the original requirement on any failure.
 */
export async function analyzeRequirement(
  requirement: string,
  language: string,
  aiCall: AICallFn,
  context?: {
    pdfContent?: string;
    documentContext?: string;
    researchContext?: string;
    userProfile?: string;
    availableDocuments?: AvailableDocument[];
  },
): Promise<RequirementAnalysis | null> {
  const none = language === 'zh-CN' ? '无' : 'None';
  const docsForPrompt = context?.availableDocuments?.length
    ? context.availableDocuments.slice(0, MAX_AVAILABLE_DOCS_IN_PROMPT)
    : [];
  const remainingCount = Math.max(
    0,
    (context?.availableDocuments?.length ?? 0) - MAX_AVAILABLE_DOCS_IN_PROMPT,
  );
  const docsSuffix =
    remainingCount > 0
      ? language === 'zh-CN'
        ? `\n... 另有 ${remainingCount} 个文档`
        : `\n... and ${remainingCount} more document(s)`
      : '';

  const prompts = buildPrompt(PROMPT_IDS.REQUIREMENT_ANALYSIS, {
    requirement,
    language,
    pdfContent: context?.pdfContent
      ? context.pdfContent.substring(0, MAX_PDF_CONTENT_CHARS)
      : none,
    documentContext: context?.documentContext || none,
    researchContext: context?.researchContext || none,
    userProfile: context?.userProfile || none,
    availableDocuments: docsForPrompt.length
      ? `${docsForPrompt.map((doc) => `- ${doc.name} (ID: ${doc.id})`).join('\n')}${docsSuffix}`
      : none,
  });

  if (!prompts) {
    log.warn('Requirement analysis prompt template not found');
    return null;
  }

  try {
    log.info(`analyzeRequirement called: cwd=${process.cwd()}, promptId=${PROMPT_IDS.REQUIREMENT_ANALYSIS}`);
    const response = await aiCall(prompts.system, prompts.user);
    const analysis = parseJsonResponse<RequirementAnalysis>(response);

    if (!analysis?.enrichedRequirement) {
      log.warn('Requirement analysis returned no enrichedRequirement');
      return null;
    }

    const ragQuery =
      typeof analysis.ragQuery === 'string' && analysis.ragQuery.trim().length > 0
        ? analysis.ragQuery.trim()
        : requirement;
    let referencedDocumentIds = Array.isArray(analysis.referencedDocumentIds)
      ? analysis.referencedDocumentIds.filter(
          (id): id is string => typeof id === 'string' && id.trim().length > 0,
        )
      : [];

    if (referencedDocumentIds.length && context?.availableDocuments?.length) {
      const validIds = new Set(context.availableDocuments.map((doc) => doc.id));
      const filteredIds = referencedDocumentIds.filter((id) => validIds.has(id));
      if (filteredIds.length === 0) {
        log.warn('All referencedDocumentIds invalid, clearing filter to avoid empty retrieval');
      }
      referencedDocumentIds = filteredIds;
    } else if (referencedDocumentIds.length && !context?.availableDocuments?.length) {
      referencedDocumentIds = [];
    }

    analysis.ragQuery = ragQuery;
    analysis.referencedDocumentIds = [...new Set(referencedDocumentIds)];

    log.info(
      `Analyzed requirement: topic="${analysis.topic}", audience=${analysis.audience}, depth=${analysis.depth}, ragQuery="${analysis.ragQuery}", referencedDocumentIds=[${analysis.referencedDocumentIds.join(',')}], effectiveDocFilterCount=${analysis.referencedDocumentIds.length}`,
    );

    return analysis;
  } catch (error) {
    log.warn('Requirement analysis failed, will use raw requirement:', error);
    return null;
  }
}
