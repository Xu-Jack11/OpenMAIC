/**
 * Requirement Analyzer
 *
 * Parses the user's free-form requirement via LLM to produce
 * a structured, enriched requirement for the outline generator.
 *
 * Uses a two-pass iteration (`lib/generation/iteration.ts`): the first pass
 * is a normal draft; if it fails structural rules or scores below the judge
 * threshold, a second revise pass runs with the critique fed back into the
 * system prompt. Iteration is opt-out via `context.iteration.enabled = false`.
 */

import { buildPrompt, PROMPT_IDS } from './prompts';
import { parseJsonResponse } from './json-repair';
import { MAX_PDF_CONTENT_CHARS } from '@/lib/constants/generation';
import type { AICallFn, GenerationCallbacks } from './pipeline-types';
import {
  iterateWithCritique,
  formatCritiqueForPrompt,
  makeLLMJudge,
  truncateJson,
  type IterationOptions,
  type RuleCheckResult,
  type CritiqueFeedback,
} from './iteration';
import { createLogger } from '@/lib/logger';

const log = createLogger('RequirementAnalyzer');
const MAX_AVAILABLE_DOCS_IN_PROMPT = 30;
const JUDGE_DRAFT_MAX_CHARS = 3000;

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

export interface RequirementAnalyzerContext {
  pdfContent?: string;
  documentContext?: string;
  researchContext?: string;
  userProfile?: string;
  availableDocuments?: AvailableDocument[];
  iteration?: IterationOptions;
  callbacks?: Pick<GenerationCallbacks, 'onProgress'>;
}

/**
 * Analyze a raw requirement and return a structured, enriched version.
 * Falls back to the original requirement on any failure.
 */
export async function analyzeRequirement(
  requirement: string,
  language: 'zh-CN' | 'en-US',
  aiCall: AICallFn,
  context?: RequirementAnalyzerContext,
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
  const availableDocumentsText = docsForPrompt.length
    ? `${docsForPrompt.map((doc) => `- ${doc.name} (ID: ${doc.id})`).join('\n')}${docsSuffix}`
    : none;

  const basePrompts = buildPrompt(PROMPT_IDS.REQUIREMENT_ANALYSIS, {
    requirement,
    language,
    pdfContent: context?.pdfContent ? context.pdfContent.substring(0, MAX_PDF_CONTENT_CHARS) : none,
    documentContext: context?.documentContext || none,
    researchContext: context?.researchContext || none,
    userProfile: context?.userProfile || none,
    availableDocuments: availableDocumentsText,
  });

  if (!basePrompts) {
    log.warn('Requirement analysis prompt template not found');
    return null;
  }

  log.info(
    `analyzeRequirement called: cwd=${process.cwd()}, promptId=${PROMPT_IDS.REQUIREMENT_ANALYSIS}`,
  );

  const availableIds = new Set(context?.availableDocuments?.map((d) => d.id) ?? []);

  const generateDraft = async (
    critique: CritiqueFeedback | null,
  ): Promise<RequirementAnalysis | null> => {
    const systemPrompt = basePrompts.system + formatCritiqueForPrompt(critique, language);
    try {
      const response = await aiCall(systemPrompt, basePrompts.user);
      const analysis = parseJsonResponse<RequirementAnalysis>(response);
      if (!analysis?.enrichedRequirement) {
        log.warn('Requirement analysis returned no enrichedRequirement');
        return null;
      }
      return normalizeAnalysis(analysis, requirement, availableIds, context?.availableDocuments);
    } catch (error) {
      log.warn('Requirement analysis aiCall/parse failed:', error);
      return null;
    }
  };

  const ruleCheck = (draft: RequirementAnalysis): RuleCheckResult =>
    checkRequirementAnalysisRules(draft, requirement, context?.availableDocuments);

  const judge = makeLLMJudge<RequirementAnalysis>(
    PROMPT_IDS.REQUIREMENT_ANALYSIS_JUDGE,
    aiCall,
    (draft) => ({
      requirement,
      language,
      availableDocuments: availableDocumentsText,
      draft: truncateJson(draft, JUDGE_DRAFT_MAX_CHARS),
    }),
  );

  const onIterationStart = (phase: 'draft' | 'revise') => {
    if (!context?.callbacks?.onProgress) return;
    const isDraft = phase === 'draft';
    const statusMessage = isDraft
      ? language === 'zh-CN'
        ? '正在分析需求...'
        : 'Analyzing requirement...'
      : language === 'zh-CN'
        ? 'AI 正在完善需求分析...'
        : 'AI is refining the requirement analysis...';
    context.callbacks.onProgress({
      currentStage: 1,
      overallProgress: isDraft ? 10 : 15,
      stageProgress: isDraft ? 25 : 50,
      statusMessage,
      scenesGenerated: 0,
      totalScenes: 0,
    });
  };

  const final = await iterateWithCritique({
    node: 'requirement-analysis',
    options: context?.iteration,
    generate: generateDraft,
    ruleCheck,
    judge,
    onIterationStart,
  });

  if (final) {
    log.info(
      `Analyzed requirement: topic="${final.topic}", audience=${final.audience}, depth=${final.depth}, ragQuery="${final.ragQuery}", referencedDocumentIds=[${final.referencedDocumentIds.join(',')}]`,
    );
  } else {
    log.warn('Requirement analysis returned null, caller will use raw requirement');
  }
  return final;
}

// ==================== Post-processing ====================

function normalizeAnalysis(
  analysis: RequirementAnalysis,
  requirement: string,
  availableIds: Set<string>,
  availableDocuments: AvailableDocument[] | undefined,
): RequirementAnalysis {
  const ragQuery =
    typeof analysis.ragQuery === 'string' && analysis.ragQuery.trim().length > 0
      ? analysis.ragQuery.trim()
      : requirement;

  let referencedDocumentIds = Array.isArray(analysis.referencedDocumentIds)
    ? analysis.referencedDocumentIds.filter(
        (id): id is string => typeof id === 'string' && id.trim().length > 0,
      )
    : [];

  if (referencedDocumentIds.length && availableDocuments?.length) {
    const filtered = referencedDocumentIds.filter((id) => availableIds.has(id));
    if (filtered.length === 0) {
      log.warn('All referencedDocumentIds invalid, clearing filter to avoid empty retrieval');
    }
    referencedDocumentIds = filtered;
  } else if (referencedDocumentIds.length && !availableDocuments?.length) {
    referencedDocumentIds = [];
  }

  return {
    ...analysis,
    ragQuery,
    referencedDocumentIds: [...new Set(referencedDocumentIds)],
  };
}

// ==================== Rule Gate ====================

const VALID_AUDIENCE = new Set(['beginner', 'intermediate', 'advanced']);
const VALID_DEPTH = new Set(['overview', 'working-knowledge', 'deep-dive']);
const VALID_STYLE = new Set(['lecture', 'hands-on', 'discussion', 'case-study', 'mixed']);

function checkRequirementAnalysisRules(
  draft: RequirementAnalysis,
  requirement: string,
  availableDocuments: AvailableDocument[] | undefined,
): RuleCheckResult {
  const violations: string[] = [];

  if (!draft.topic || draft.topic.trim().length <= 3) {
    violations.push(
      '`topic` is empty or too short (must be a concrete phrase longer than 3 chars)',
    );
  }
  if (!VALID_AUDIENCE.has(draft.audience)) {
    violations.push(
      `\`audience\` must be one of beginner/intermediate/advanced (got "${draft.audience}")`,
    );
  }
  if (!VALID_DEPTH.has(draft.depth)) {
    violations.push(
      `\`depth\` must be one of overview/working-knowledge/deep-dive (got "${draft.depth}")`,
    );
  }
  if (!VALID_STYLE.has(draft.style)) {
    violations.push(
      `\`style\` must be one of lecture/hands-on/discussion/case-study/mixed (got "${draft.style}")`,
    );
  }
  if (!draft.enrichedRequirement || draft.enrichedRequirement.trim().length < 50) {
    violations.push('`enrichedRequirement` must be a detailed paragraph (≥ 50 chars)');
  }

  if (availableDocuments?.length) {
    const query = (draft.ragQuery || '').trim();
    if (query.length < 5) {
      violations.push('`ragQuery` must be non-empty (≥ 5 chars) when course documents are present');
    } else if (query === requirement.trim()) {
      violations.push(
        '`ragQuery` must be a focused retrieval query, not a verbatim copy of the raw requirement',
      );
    }
    // referencedDocumentIds is not required to be non-empty — sometimes no
    // document is obviously relevant and the judge evaluates the choice.
  }

  return { passed: violations.length === 0, violations };
}
