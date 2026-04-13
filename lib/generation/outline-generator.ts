/**
 * Stage 1: Generate scene outlines from user requirements.
 * Also contains outline fallback logic.
 *
 * Uses iterative critique (`lib/generation/iteration.ts`) when enabled: the
 * initial draft is rule-checked (structure + RAG-term coverage) and judged
 * by an LLM rubric; a second revision pass runs if either gate fails.
 */

import { nanoid } from 'nanoid';
import { MAX_PDF_CONTENT_CHARS, MAX_VISION_IMAGES } from '@/lib/constants/generation';
import type {
  UserRequirements,
  SceneOutline,
  PdfImage,
  ImageMapping,
} from '@/lib/types/generation';
import { buildPrompt, PROMPT_IDS } from './prompts';
import { formatImageDescription, formatImagePlaceholder } from './prompt-formatters';
import { parseJsonResponse } from './json-repair';
import { uniquifyMediaElementIds } from './scene-builder';
import type { AICallFn, GenerationResult, GenerationCallbacks } from './pipeline-types';
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
const log = createLogger('Generation');

const MAX_DOCUMENT_CONTEXT_FOR_JUDGE = 1500;
const MAX_DRAFT_FOR_JUDGE = 6000;
const MIN_RAG_TERM_COVERAGE = 0.15;

/**
 * Generate scene outlines from user requirements
 * Now uses simplified UserRequirements with just requirement text and language
 */
export async function generateSceneOutlinesFromRequirements(
  requirements: UserRequirements,
  pdfText: string | undefined,
  pdfImages: PdfImage[] | undefined,
  aiCall: AICallFn,
  callbacks?: GenerationCallbacks,
  options?: {
    visionEnabled?: boolean;
    imageMapping?: ImageMapping;
    imageGenerationEnabled?: boolean;
    videoGenerationEnabled?: boolean;
    researchContext?: string;
    teacherContext?: string;
    /** RAG-retrieved course document context */
    documentContext?: string;
    /** Plugin guidance text */
    pluginGuidance?: string;
    /** Self-iteration settings (draft → judge → revise) */
    iteration?: IterationOptions;
  },
): Promise<GenerationResult<SceneOutline[]>> {
  // Build available images description for the prompt
  let availableImagesText =
    requirements.language === 'zh-CN' ? '无可用图片' : 'No images available';
  let visionImages: Array<{ id: string; src: string }> | undefined;

  if (pdfImages && pdfImages.length > 0) {
    if (options?.visionEnabled && options?.imageMapping) {
      // Vision mode: split into vision images (first N) and text-only (rest)
      const allWithSrc = pdfImages.filter((img) => options.imageMapping![img.id]);
      const visionSlice = allWithSrc.slice(0, MAX_VISION_IMAGES);
      const textOnlySlice = allWithSrc.slice(MAX_VISION_IMAGES);
      const noSrcImages = pdfImages.filter((img) => !options.imageMapping![img.id]);

      const visionDescriptions = visionSlice.map((img) =>
        formatImagePlaceholder(img, requirements.language),
      );
      const textDescriptions = [...textOnlySlice, ...noSrcImages].map((img) =>
        formatImageDescription(img, requirements.language),
      );
      availableImagesText = [...visionDescriptions, ...textDescriptions].join('\n');

      visionImages = visionSlice.map((img) => ({
        id: img.id,
        src: options.imageMapping![img.id],
        width: img.width,
        height: img.height,
      }));
    } else {
      // Text-only mode: full descriptions
      availableImagesText = pdfImages
        .map((img) => formatImageDescription(img, requirements.language))
        .join('\n');
    }
  }

  // Build user profile string for prompt injection
  const userProfileText =
    requirements.userNickname || requirements.userBio
      ? `## Student Profile\n\nStudent: ${requirements.userNickname || 'Unknown'}${requirements.userBio ? ` — ${requirements.userBio}` : ''}\n\nConsider this student's background when designing the course. Adapt difficulty, examples, and teaching approach accordingly.\n\n---`
      : '';

  // Build media generation policy based on enabled flags
  const imageEnabled = options?.imageGenerationEnabled ?? false;
  const videoEnabled = options?.videoGenerationEnabled ?? false;
  let mediaGenerationPolicy = '';
  if (!imageEnabled && !videoEnabled) {
    mediaGenerationPolicy =
      '**IMPORTANT: Do NOT include any mediaGenerations in the outlines. Both image and video generation are disabled.**';
  } else if (!imageEnabled) {
    mediaGenerationPolicy =
      '**IMPORTANT: Do NOT include any image mediaGenerations (type: "image") in the outlines. Image generation is disabled. Video generation is allowed.**';
  } else if (!videoEnabled) {
    mediaGenerationPolicy =
      '**IMPORTANT: Do NOT include any video mediaGenerations (type: "video") in the outlines. Video generation is disabled. Image generation is allowed.**';
  }

  const noneLabel = requirements.language === 'zh-CN' ? '无' : 'None';
  const documentContextForPrompt =
    options?.documentContext ||
    (requirements.language === 'zh-CN' ? '无课程文档' : 'No course documents');

  // Use simplified prompt variables
  const basePrompts = buildPrompt(PROMPT_IDS.REQUIREMENTS_TO_OUTLINES, {
    requirement: requirements.requirement,
    language: requirements.language,
    pdfContent: pdfText ? pdfText.substring(0, MAX_PDF_CONTENT_CHARS) : noneLabel,
    availableImages: availableImagesText,
    userProfile: userProfileText,
    mediaGenerationPolicy,
    researchContext: options?.researchContext || noneLabel,
    documentContext: documentContextForPrompt,
    teacherContext: options?.teacherContext || '',
    pluginGuidance: options?.pluginGuidance || '',
  });

  if (!basePrompts) {
    return { success: false, error: 'Prompt template not found' };
  }

  const generateDraft = async (
    critique: CritiqueFeedback | null,
  ): Promise<SceneOutline[] | null> => {
    const systemPrompt =
      basePrompts.system + formatCritiqueForPrompt(critique, requirements.language);
    try {
      const response = await aiCall(systemPrompt, basePrompts.user, visionImages);
      const outlines = parseJsonResponse<SceneOutline[]>(response);
      if (!outlines || !Array.isArray(outlines) || outlines.length === 0) {
        log.warn('Outline generator returned no valid outlines array');
        return null;
      }
      // Ensure IDs, order, and language
      const enriched = outlines.map((outline, index) => ({
        ...outline,
        id: outline.id || nanoid(),
        order: index + 1,
        language: requirements.language,
      }));
      return uniquifyMediaElementIds(enriched);
    } catch (error) {
      log.warn('Outline generator aiCall/parse failed:', error);
      return null;
    }
  };

  const ruleCheck = (draft: SceneOutline[]): RuleCheckResult =>
    checkOutlineRules(draft, options?.documentContext);

  const judge = makeLLMJudge<SceneOutline[]>(PROMPT_IDS.OUTLINE_JUDGE, aiCall, (draft) => ({
    requirement: requirements.requirement,
    language: requirements.language,
    documentContext:
      (options?.documentContext || '').slice(0, MAX_DOCUMENT_CONTEXT_FOR_JUDGE) || noneLabel,
    draft: truncateJson(draft, MAX_DRAFT_FOR_JUDGE),
  }));

  const onIterationStart = (phase: 'draft' | 'revise') => {
    if (!callbacks?.onProgress) return;
    const isZh = requirements.language === 'zh-CN';
    const isDraft = phase === 'draft';
    const statusMessage = isDraft
      ? isZh
        ? '正在分析需求，生成场景大纲...'
        : 'Analyzing requirement, generating scene outlines...'
      : isZh
        ? 'AI 正在审视并优化大纲...'
        : 'AI is reviewing and refining the outline...';
    callbacks.onProgress({
      currentStage: 1,
      overallProgress: isDraft ? 20 : 35,
      stageProgress: isDraft ? 50 : 75,
      statusMessage,
      scenesGenerated: 0,
      totalScenes: 0,
    });
  };

  const final = await iterateWithCritique({
    node: 'outline',
    options: options?.iteration,
    generate: generateDraft,
    ruleCheck,
    judge,
    onIterationStart,
  });

  if (!final) {
    return { success: false, error: 'Failed to parse scene outlines response' };
  }

  callbacks?.onProgress?.({
    currentStage: 1,
    overallProgress: 50,
    stageProgress: 100,
    statusMessage: `已生成 ${final.length} 个场景大纲`,
    scenesGenerated: 0,
    totalScenes: final.length,
  });

  return { success: true, data: final };
}

// ==================== Rule Gate ====================

const VALID_SCENE_TYPES = new Set(['slide', 'quiz', 'interactive', 'pbl']);

function checkOutlineRules(
  outlines: SceneOutline[],
  documentContext: string | undefined,
): RuleCheckResult {
  const violations: string[] = [];

  if (outlines.length === 0) {
    return { passed: false, violations: ['outline array is empty'] };
  }
  if (outlines.length > 20) {
    violations.push(`outline array has ${outlines.length} scenes (must be ≤ 20)`);
  }

  const titles = new Set<string>();
  outlines.forEach((o, index) => {
    const label = o.title ? `"${o.title}"` : `scene #${index + 1}`;
    if (!o.title || o.title.trim().length === 0) {
      violations.push(`${label} has empty title`);
    } else if (titles.has(o.title.trim())) {
      violations.push(`duplicate title: ${label}`);
    } else {
      titles.add(o.title.trim());
    }
    if (!o.type || !VALID_SCENE_TYPES.has(o.type)) {
      violations.push(`${label} has invalid type "${o.type}" (must be slide/quiz/interactive/pbl)`);
    }
    if (!Array.isArray(o.keyPoints) || o.keyPoints.length === 0) {
      violations.push(`${label} has empty keyPoints (must list 3-5 specific points)`);
    }
    if (!o.description || o.description.trim().length === 0) {
      violations.push(`${label} has empty description`);
    }
  });

  // Document integration check: only when RAG context is actually available.
  if (documentContext && documentContext.trim().length > 50) {
    const coverage = computeRagCoverage(outlines, documentContext);
    if (coverage < MIN_RAG_TERM_COVERAGE) {
      violations.push(
        `outline ignores provided document context (term coverage ${(coverage * 100).toFixed(1)}% < ${(MIN_RAG_TERM_COVERAGE * 100).toFixed(0)}%); keyPoints and descriptions must reference specific concepts from the documents`,
      );
    }
  }

  return { passed: violations.length === 0, violations };
}

/**
 * Rough RAG-integration heuristic: what fraction of "signature" terms from the
 * document context appear somewhere in the outline's titles/descriptions/keyPoints.
 * Signature terms are words ≥ 4 chars that appear ≥ 2 times in the document
 * context and are not common stop-ish words. Intentionally crude — its only
 * job is to catch outlines that talk pure generalities while RAG docs were
 * available. The LLM judge does the nuanced evaluation.
 */
function computeRagCoverage(outlines: SceneOutline[], documentContext: string): number {
  const terms = extractSignatureTerms(documentContext);
  if (terms.length === 0) return 1; // nothing distinctive to check against, pass

  const outlineText = outlines
    .map((o) =>
      [o.title || '', o.description || '', ...(o.keyPoints || [])].join(' ').toLowerCase(),
    )
    .join(' ');

  let hits = 0;
  for (const term of terms) {
    if (outlineText.includes(term)) hits++;
  }
  return hits / terms.length;
}

const STOP_WORDS = new Set([
  'this',
  'that',
  'with',
  'from',
  'have',
  'they',
  'will',
  'been',
  'would',
  'could',
  'should',
  'there',
  'where',
  'which',
  'about',
  'other',
  'these',
  'those',
  'their',
  'because',
  'while',
  'when',
  'then',
  'than',
  'some',
  'into',
  'over',
  'only',
  'more',
  'most',
  'also',
  'such',
  'very',
]);

function extractSignatureTerms(text: string): string[] {
  const lower = text.toLowerCase();
  // Match latin word runs of length ≥ 4, or runs of 2+ CJK characters.
  const tokens = lower.match(/[a-z][a-z0-9_-]{3,}|[\u4e00-\u9fff]{2,}/g) ?? [];
  const counts = new Map<string, number>();
  for (const t of tokens) {
    if (STOP_WORDS.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  // Keep tokens that recur (≥ 2 occurrences) — they're more likely topical.
  const signatures = [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([t]) => t);
  return signatures;
}

/**
 * Apply type fallbacks for outlines that can't be generated as their declared type.
 * - interactive without interactiveConfig → slide
 * - pbl without pblConfig or languageModel → slide
 */
export function applyOutlineFallbacks(
  outline: SceneOutline,
  hasLanguageModel: boolean,
): SceneOutline {
  if (outline.type === 'interactive' && !outline.interactiveConfig) {
    log.warn(
      `Interactive outline "${outline.title}" missing interactiveConfig, falling back to slide`,
    );
    return { ...outline, type: 'slide' };
  }
  if (outline.type === 'pbl' && (!outline.pblConfig || !hasLanguageModel)) {
    log.warn(
      `PBL outline "${outline.title}" missing pblConfig or languageModel, falling back to slide`,
    );
    return { ...outline, type: 'slide' };
  }
  return outline;
}
