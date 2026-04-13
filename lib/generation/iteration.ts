/**
 * Generic self-iteration utility: draft → rule-gate → LLM-judge → revise.
 *
 * Shared by Stage 0 (requirement analysis) and Stage 1 (outline generation)
 * to lift generation quality without new infrastructure. See
 * `lib/generation/requirement-analyzer.ts` and `outline-generator.ts` for
 * real usage.
 *
 * Flow (hard-capped at 2 iterations):
 *   1. generate(null) → draft1
 *   2. ruleCheck(draft1)
 *      - fails → critique = {violations}; skip judge; revise
 *      - passes → if judge: score ≥ threshold → return draft1 (early stop)
 *                          score <  threshold → critique = {issues, suggestions}; revise
 *                 no judge → return draft1
 *   3. generate(critique) → draft2
 *      - null → fallback to draft1
 *      - ruleCheck fails → fallback to draft1 (don't let a bad revision win)
 *      - passes → return draft2
 *
 * The tool is prompt-agnostic: `generate(critique)` is responsible for
 * weaving the critique into its own prompt structure.
 */

import { buildPrompt, type PromptId } from './prompts';
import { parseJsonResponse } from './json-repair';
import type { AICallFn } from './pipeline-types';
import { createLogger } from '@/lib/logger';

const log = createLogger('Iteration');

// ==================== Public Types ====================

export interface IterationOptions {
  /** Disable iteration entirely (single call). Default true. */
  enabled?: boolean;
  /** Max total attempts including draft. Default 2, hard-capped to 2 for now. */
  maxIterations?: number;
  /** LLM judge score needed to accept draft (0-100). Default 80. */
  qualityThreshold?: number;
}

export interface RuleCheckResult {
  passed: boolean;
  /** Human-readable reasons why rules failed (feeds into critique). */
  violations: string[];
}

export interface JudgeResult {
  /** 0-100. Values outside the range are clamped during evaluation. */
  score: number;
  issues: string[];
  suggestions: string[];
}

export interface CritiqueFeedback {
  violations: string[];
  issues: string[];
  suggestions: string[];
}

export interface IterationConfig<T> {
  /** Used for logging. */
  node: string;
  options?: IterationOptions;
  /** Draft generator. Receives critique on revision attempts (null on first). */
  generate: (critique: CritiqueFeedback | null) => Promise<T | null>;
  /** Fast structural check. Must never call the LLM. */
  ruleCheck: (draft: T) => RuleCheckResult;
  /** Optional semantic judge. Omit to skip LLM scoring. */
  judge?: (draft: T) => Promise<JudgeResult>;
  /** Emit progress to outside (e.g., GenerationProgress.statusMessage). */
  onIterationStart?: (phase: 'draft' | 'revise') => void;
}

// ==================== Implementation ====================

const DEFAULT_MAX = 2;
const DEFAULT_THRESHOLD = 80;
const HARD_MAX = 2;

/**
 * Run the draft → critique → revise loop and return the best acceptable output.
 *
 * Returns the first draft that passes both rules and judge threshold, or the
 * revised draft if it passes rules, or the original draft as a safe fallback.
 * Returns `null` only if the first `generate()` itself returns `null`.
 */
export async function iterateWithCritique<T>(config: IterationConfig<T>): Promise<T | null> {
  const { node, options, generate, ruleCheck, judge, onIterationStart } = config;

  const enabled = options?.enabled ?? true;
  const qualityThreshold = options?.qualityThreshold ?? DEFAULT_THRESHOLD;
  const requestedMax = options?.maxIterations ?? DEFAULT_MAX;
  const maxIterations = Math.min(Math.max(1, requestedMax), HARD_MAX);

  // Fast path: iteration disabled — single call, no judging.
  if (!enabled || maxIterations < 2) {
    onIterationStart?.('draft');
    const single = await generate(null);
    log.info(`[${node}] iteration disabled, single-pass result=${single ? 'ok' : 'null'}`);
    return single;
  }

  // Attempt 1 — draft
  onIterationStart?.('draft');
  const draft = await generate(null);
  if (!draft) {
    log.warn(`[${node}] draft generation returned null, giving up`);
    return null;
  }

  const rule1 = ruleCheck(draft);
  let critique: CritiqueFeedback | null = null;

  if (!rule1.passed) {
    log.info(
      `[${node}] attempt 1: rule=FAIL (${rule1.violations.length} violations), revising without judge`,
    );
    critique = {
      violations: rule1.violations,
      issues: [],
      suggestions: [],
    };
  } else if (judge) {
    const judgeResult = await runJudge(judge, draft, node);
    if (judgeResult.score >= qualityThreshold) {
      log.info(
        `[${node}] attempt 1: rule=PASS, judge=${judgeResult.score} ≥ ${qualityThreshold}, ACCEPT`,
      );
      return draft;
    }
    log.info(
      `[${node}] attempt 1: rule=PASS, judge=${judgeResult.score} < ${qualityThreshold}, revising`,
    );
    critique = {
      violations: [],
      issues: judgeResult.issues,
      suggestions: judgeResult.suggestions,
    };
  } else {
    // No judge configured; rule-pass is enough to accept.
    log.info(`[${node}] attempt 1: rule=PASS, no judge configured, ACCEPT`);
    return draft;
  }

  // Attempt 2 — revise
  onIterationStart?.('revise');
  const revised = await generate(critique);
  if (!revised) {
    log.warn(`[${node}] attempt 2: generate returned null, falling back to draft`);
    return draft;
  }
  const rule2 = ruleCheck(revised);
  if (!rule2.passed) {
    log.warn(
      `[${node}] attempt 2: rule=FAIL (${rule2.violations.length} violations), falling back to draft`,
    );
    return draft;
  }
  log.info(`[${node}] attempt 2: rule=PASS, ACCEPT revised`);
  return revised;
}

async function runJudge<T>(
  judge: (draft: T) => Promise<JudgeResult>,
  draft: T,
  node: string,
): Promise<JudgeResult> {
  try {
    const result = await judge(draft);
    // Clamp score to [0, 100] so an out-of-range judge can't force an accept
    // or force an extra iteration.
    const clamped = Math.max(0, Math.min(100, Number.isFinite(result.score) ? result.score : 0));
    return {
      score: clamped,
      issues: Array.isArray(result.issues) ? result.issues : [],
      suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
    };
  } catch (error) {
    log.warn(`[${node}] judge threw, treating as score=0 (revision will be attempted):`, error);
    return { score: 0, issues: ['Judge threw an error during evaluation'], suggestions: [] };
  }
}

// ==================== LLM Judge Helper ====================

/**
 * Build a judge function that loads a prompt template, calls the LLM, and
 * parses a `{ score, issues, suggestions }` response. All normalization
 * (clamping, array coercion) happens downstream in `runJudge` — this helper
 * only needs to hand back something parseable or let `runJudge` catch.
 *
 * Missing template or unparseable response maps to `score: 100` (treat as
 * pass) so that infrastructure failure doesn't force a wasted revise. A
 * thrown `aiCall` propagates and is caught by `runJudge` (→ `score: 0`) —
 * that's the intended signal for "judge is unavailable, still try to
 * improve the draft".
 */
export function makeLLMJudge<T>(
  promptId: PromptId,
  aiCall: AICallFn,
  buildVariables: (draft: T) => Record<string, unknown>,
): (draft: T) => Promise<JudgeResult> {
  return async (draft: T) => {
    const prompts = buildPrompt(promptId, buildVariables(draft));
    if (!prompts) {
      log.warn(`[judge:${promptId}] prompt template missing — treating as pass`);
      return { score: 100, issues: [], suggestions: [] };
    }
    const raw = await aiCall(prompts.system, prompts.user);
    const parsed = parseJsonResponse<Partial<JudgeResult>>(raw);
    if (!parsed || typeof parsed.score !== 'number') {
      log.warn(`[judge:${promptId}] response unparseable — treating as pass`);
      return { score: 100, issues: [], suggestions: [] };
    }
    return parsed as JudgeResult;
  };
}

// ==================== Misc Helpers ====================

/**
 * Stringify a value as pretty JSON, truncating to `maxChars` with a visible
 * marker. Intended for feeding drafts into judge prompts — the judge reads
 * prose, so mid-JSON truncation is safe.
 */
export function truncateJson(value: unknown, maxChars: number): string {
  const json = JSON.stringify(value, null, 2);
  if (json.length <= maxChars) return json;
  return `${json.slice(0, maxChars)}\n... [truncated for judge]`;
}

// ==================== Critique Formatting Helpers ====================

/**
 * Format a CritiqueFeedback block in the course language, for appending to
 * a generator's system prompt on revision attempts. Returns empty string
 * when there is nothing useful to say.
 */
export function formatCritiqueForPrompt(
  critique: CritiqueFeedback | null,
  language: 'zh-CN' | 'en-US',
): string {
  if (!critique) return '';
  const { violations, issues, suggestions } = critique;
  if (violations.length === 0 && issues.length === 0 && suggestions.length === 0) {
    return '';
  }

  const isZh = language === 'zh-CN';
  const lines: string[] = [];

  lines.push(
    isZh
      ? '\n\n---\n\n## 对上次输出的审视反馈\n\n上一次生成未达标，请在本次生成中直接解决以下问题，不要重复出错：'
      : '\n\n---\n\n## Critique of Previous Attempt\n\nThe previous attempt did not meet quality standards. Address these problems directly in this output — do not repeat them:',
  );

  if (violations.length > 0) {
    lines.push(isZh ? '\n### 结构/字段问题（必须修复）' : '\n### Structural violations (must fix)');
    for (const v of violations) lines.push(`- ${v}`);
  }
  if (issues.length > 0) {
    lines.push(isZh ? '\n### 质量问题' : '\n### Quality issues');
    for (const i of issues) lines.push(`- ${i}`);
  }
  if (suggestions.length > 0) {
    lines.push(isZh ? '\n### 改进建议' : '\n### Improvement suggestions');
    for (const s of suggestions) lines.push(`- ${s}`);
  }
  lines.push(
    isZh
      ? '\n请生成一个完整的、修正后的版本，只输出新结果，不要解释差异。'
      : '\nProduce a complete revised output. Return the final result only — do not explain differences.',
  );

  return lines.join('\n');
}
