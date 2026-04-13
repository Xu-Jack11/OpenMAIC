/**
 * 同步本地 DB 的 indexStatus 与 RAGFlow 的真实解析状态
 *
 * 当迁移脚本或上传流程因超时被提前标记为 `failed` 时，实际 RAGFlow 可能仍在处理。
 * 本脚本通过查询 RAGFlow API 获取真实状态，回写本地数据库。
 *
 * 使用方法：
 *   npx tsx scripts/sync-ragflow-status.ts
 *
 * 可重复执行：显示每个文档的真实状态，并更新数据库。
 */

import { prisma } from '../lib/server/db';
import * as ragflow from '../lib/rag/ragflow-client';

type RunStatus = 'UNSTART' | 'RUNNING' | 'CANCEL' | 'DONE' | 'FAIL';

function mapRagflowRun(run: RunStatus): 'pending' | 'indexing' | 'indexed' | 'failed' {
  switch (run) {
    case 'UNSTART':
      return 'pending';
    case 'RUNNING':
      return 'indexing';
    case 'DONE':
      return 'indexed';
    case 'FAIL':
    case 'CANCEL':
      return 'failed';
  }
}

async function main() {
  if (!ragflow.isConfigured()) {
    console.error('❌ RAGFLOW_BASE_URL / RAGFLOW_API_KEY 未配置');
    process.exit(1);
  }

  // 查找所有有 ragflowDocumentId 的文档
  const docs = await prisma.document.findMany({
    where: { ragflowDocumentId: { not: null } },
    include: { course: true },
    orderBy: { createdAt: 'asc' },
  });

  if (docs.length === 0) {
    console.log('没有已上传到 RAGFlow 的文档。');
    await prisma.$disconnect();
    return;
  }

  console.log(`找到 ${docs.length} 个已上传到 RAGFlow 的文档\n`);

  let updated = 0;
  for (const doc of docs) {
    if (!doc.course.ragflowDatasetId || !doc.ragflowDocumentId) continue;

    try {
      const status = await ragflow.getDocumentStatus(
        doc.course.ragflowDatasetId,
        doc.ragflowDocumentId,
      );

      const newStatus = mapRagflowRun(status.run as RunStatus);
      const progressRaw = (status as unknown as { progress?: number }).progress;
      const progress = typeof progressRaw === 'number' ? progressRaw : 0;
      const progressPct = (progress * 100).toFixed(1);

      const changed = doc.indexStatus !== newStatus;
      const marker = changed ? '🔄' : '  ';

      console.log(`${marker} [${newStatus.padEnd(8)}] ${progressPct.padStart(5)}%  ${doc.name}`);

      if (changed) {
        await prisma.document.update({
          where: { id: doc.id },
          data: {
            indexStatus: newStatus,
            indexError: newStatus === 'failed' ? 'RAGFlow parsing failed' : null,
          },
        });
        updated++;
      }
    } catch (err) {
      console.error(`❌ ${doc.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n完成。更新了 ${updated} 条记录。`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ERROR:', e);
  await prisma.$disconnect();
  process.exit(1);
});
