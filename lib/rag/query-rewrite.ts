/**
 * Query rewriting for RAG retrieval.
 *
 * Produces two artefacts from a user query:
 *   - `rewrites`: up to 3 semantically-equivalent paraphrases to widen recall
 *   - `hyde`:     a short hypothetical answer paragraph, used as an alternate
 *                 embedding target (HyDE: Hypothetical Document Embeddings)
 *
 * Both artefacts are optional — if the local LLM call fails or is disabled
 * via env flags, this module degrades gracefully and returns empty arrays
 * so the retriever can fall back to original-query-only search.
 *
 * The model is the project's standard chat model (reuses `lib/ai/providers.ts`
 * + `lib/server/resolve-model.ts`). Override with `RAG_REWRITE_MODEL` if you
 * want a cheaper model for this task.
 */

import { parseJsonResponse } from '@/lib/generation/generation-pipeline';
import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import { createLogger } from '@/lib/logger';

const log = createLogger('RAG:QueryRewrite');

export interface RewriteOptions {
  enableRewrite?: boolean;
  enableHyde?: boolean;
}

export interface RewriteResult {
  /** Semantically equivalent paraphrases of the original query. */
  rewrites: string[];
  /** Hypothetical answer paragraph; empty string when disabled/failed. */
  hyde: string;
}

function readFlag(envVar: string, fallback: boolean): boolean {
  const v = process.env[envVar];
  if (v === undefined) return fallback;
  return !(v === 'false' || v === '0' || v.toLowerCase() === 'off');
}

const SYSTEM_PROMPT = `你是一个检索助手。根据用户查询,产出两类内容帮助向量检索:
1) "rewrites": 3 个语义等价的改写,覆盖同义词、不同提问角度、学科术语和口语化说法。
2) "hyde": 一段 2-4 句的"假设答案"(直接回答该问题,像从文档里摘抄一段),用于 HyDE 检索。

严格返回 JSON,不要 markdown 代码块:
{"rewrites": ["...","...","..."], "hyde": "..."}`;

/**
 * Rewrite a single query.
 */
export async function rewriteQuery(
  query: string,
  opts: RewriteOptions = {},
): Promise<RewriteResult> {
  const enableRewrite = opts.enableRewrite ?? readFlag('RAG_ENABLE_REWRITE', true);
  const enableHyde = opts.enableHyde ?? readFlag('RAG_ENABLE_HYDE', true);

  if (!enableRewrite && !enableHyde) {
    return { rewrites: [], hyde: '' };
  }

  const modelString = process.env.RAG_REWRITE_MODEL || process.env.DEFAULT_MODEL;
  if (!modelString) {
    log.warn('RAG_REWRITE_MODEL and DEFAULT_MODEL unset — skipping rewrite');
    return { rewrites: [], hyde: '' };
  }

  try {
    const { model } = resolveModel({ modelString });
    const result = await callLLM(
      {
        model,
        system: SYSTEM_PROMPT,
        prompt: `用户查询: ${query.trim()}`,
        temperature: 0.3,
        // 2048 gives reasoning models (Qwen3, DeepSeek-R1) enough room even
        // if thinking isn't disabled upstream. Regular models finish in <200.
        maxOutputTokens: 2048,
      },
      'rag-query-rewrite',
      undefined,
      // Disable thinking for this simple JSON-format task. The provider layer
      // injects { enable_thinking: false } for qwen/siliconflow, or equivalent
      // for deepseek/glm/kimi. No-op for models without thinking.
      { enabled: false },
    );

    const parsed = parseJsonResponse<{ rewrites?: unknown; hyde?: unknown }>(result.text);
    if (!parsed) {
      log.warn('Query rewrite LLM returned unparseable JSON; falling back');
      return { rewrites: [], hyde: '' };
    }
    const rewrites = enableRewrite ? normaliseRewrites(parsed.rewrites) : [];
    const hyde = enableHyde ? normaliseHyde(parsed.hyde) : '';
    return { rewrites, hyde };
  } catch (err) {
    log.warn(`Query rewrite failed (${(err as Error).message}); falling back`);
    return { rewrites: [], hyde: '' };
  }
}

function normaliseRewrites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== 'string') continue;
    const trimmed = r.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= 3) break;
  }
  return out;
}

function normaliseHyde(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, 1000);
}
