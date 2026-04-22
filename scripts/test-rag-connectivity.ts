/**
 * Smoke-test connectivity to all self-hosted RAG services.
 *
 * Usage:
 *   npx tsx scripts/test-rag-connectivity.ts
 *
 * Exits 0 if every configured service responds as expected, 1 otherwise.
 */

import { probeDim } from '../lib/rag/embedding-client';
import { rerank, isConfigured as isRerankConfigured } from '../lib/rag/rerank-client';
import { isConfigured as isMineruConfigured } from '../lib/rag/mineru-client';
import { proxyFetch } from '../lib/server/proxy-fetch';

async function main() {
  let failures = 0;

  // --- Embedding -----------------------------------------------------------
  if (!process.env.EMBEDDING_BASE_URL) {
    console.error('❌ EMBEDDING_BASE_URL not set');
    failures++;
  } else {
    try {
      const dim = await probeDim();
      console.log(`✅ embedding: ${process.env.EMBEDDING_MODEL} — dim = ${dim}`);
    } catch (err) {
      console.error(`❌ embedding: ${(err as Error).message}`);
      failures++;
    }
  }

  // --- Rerank --------------------------------------------------------------
  if (!isRerankConfigured()) {
    console.log('⏭  rerank: RERANK_BASE_URL not set — skipped');
  } else {
    try {
      const out = await rerank('神经网络的前向传播', [
        { id: 'a', text: '前向传播是神经网络从输入层到输出层依次计算的过程' },
        { id: 'b', text: '图灵机是一种计算模型' },
      ]);
      if (out.length !== 2) throw new Error(`expected 2 results, got ${out.length}`);
      console.log(
        `✅ rerank: ${process.env.RERANK_MODEL} — top = ${out[0].id} (${out[0].score.toFixed(3)})`,
      );
    } catch (err) {
      console.error(`❌ rerank: ${(err as Error).message}`);
      failures++;
    }
  }

  // --- MinerU --------------------------------------------------------------
  if (!isMineruConfigured()) {
    console.log('⏭  mineru: MINERU_BASE_URL not set — skipped (fallback to unpdf)');
  } else {
    try {
      const url = (process.env.MINERU_BASE_URL || '').replace(/\/+$/, '') + '/docs';
      const res = await proxyFetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`GET /docs returned ${res.status}`);
      console.log(
        `✅ mineru: reachable at ${process.env.MINERU_BASE_URL} (backend=${process.env.MINERU_BACKEND || 'hybrid-auto-engine'})`,
      );
    } catch (err) {
      console.error(`❌ mineru: ${(err as Error).message}`);
      failures++;
    }
  }

  // --- Rewrite LLM ---------------------------------------------------------
  const rewriteModel = process.env.RAG_REWRITE_MODEL || process.env.DEFAULT_MODEL;
  if (rewriteModel) {
    console.log(`ℹ  rewrite LLM: ${rewriteModel} (used for query rewriting / HyDE)`);
  } else {
    console.log('⏭  rewrite LLM: RAG_REWRITE_MODEL / DEFAULT_MODEL unset — rewrite disabled');
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll configured services OK.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
