/**
 * RAGFlow 连通性测试脚本
 * 测试：配置 → 健康检查 → 创建 dataset → 上传文档 → 解析 → 检索 → 清理
 */

import * as ragflow from '../lib/rag/ragflow-client';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('='.repeat(60));
  console.log('RAGFlow 连通性测试');
  console.log('='.repeat(60));
  console.log(`BASE_URL: ${process.env.RAGFLOW_BASE_URL}`);
  console.log(`API_KEY:  ${process.env.RAGFLOW_API_KEY ? '<已配置>' : '<未配置>'}`);
  console.log('');

  // 1. 配置检查
  console.log('[1/7] 配置检查...');
  if (!ragflow.isConfigured()) {
    console.error('  ❌ RAGFLOW_BASE_URL 或 RAGFLOW_API_KEY 未设置');
    process.exit(1);
  }
  console.log('  ✅ 配置完整');

  // 2. 健康检查
  console.log('\n[2/7] 健康检查（GET /datasets）...');
  const healthy = await ragflow.healthCheck();
  if (!healthy) {
    console.error('  ❌ RAGFlow 不可达');
    process.exit(1);
  }
  console.log('  ✅ RAGFlow 可达');

  let datasetId: string | null = null;
  let docId: string | null = null;

  try {
    // 3. 创建测试 dataset
    console.log('\n[3/7] 创建测试 dataset...');
    datasetId = await ragflow.createDataset('openmaic-connectivity-test');
    console.log(`  ✅ 已创建 dataset: ${datasetId}`);

    // 4. 上传测试文档
    console.log('\n[4/7] 上传测试文档...');
    const content = [
      '人工智能（AI）是计算机科学的分支，旨在构建模拟人类智能的系统。',
      '机器学习通过数据训练模型完成任务，是 AI 的核心方法之一。',
      '深度学习是机器学习的子集，使用多层神经网络。',
      '自然语言处理让计算机理解人类语言，大模型如 GPT、Claude 展现强大能力。',
    ].join('\n');
    const buffer = Buffer.from(content, 'utf-8');
    docId = await ragflow.uploadDocument(datasetId, buffer, 'ai-intro.txt');
    console.log(`  ✅ 已上传文档: ${docId}`);

    // 5. 触发解析
    console.log('\n[5/7] 触发解析...');
    await ragflow.startParsing(datasetId, [docId]);
    console.log('  ✅ 解析已启动，轮询状态...');

    const deadline = Date.now() + 180_000; // 3 分钟超时
    let interval = 2000;
    let finalStatus: string = 'UNSTART';
    while (Date.now() < deadline) {
      await sleep(interval);
      const status = await ragflow.getDocumentStatus(datasetId, docId);
      process.stdout.write(`     status=${status.run} ... `);
      if (status.run === 'DONE') {
        finalStatus = 'DONE';
        console.log('✅');
        break;
      }
      if (status.run === 'FAIL' || status.run === 'CANCEL') {
        finalStatus = status.run;
        console.log('❌');
        break;
      }
      console.log('等待...');
      interval = Math.min(interval + 500, 5000);
    }
    if (finalStatus !== 'DONE') {
      console.error(`  ❌ 解析未完成（最终状态 ${finalStatus}）`);
      console.error('  提示：请检查 RAGFlow 的 Embedding Model 是否已在 Model Providers 配置');
      process.exit(1);
    }

    // 6. 检索测试
    console.log('\n[6/7] 检索测试（query: "深度学习"）...');
    const chunks = await ragflow.retrieve({
      datasetIds: [datasetId],
      question: '什么是深度学习',
      topK: 3,
      similarityThreshold: 0.1,
    });
    console.log(`  ✅ 返回 ${chunks.length} 个 chunk`);
    chunks.forEach((c, i) => {
      console.log(
        `     [${i + 1}] similarity=${c.similarity.toFixed(4)}  ${c.content.substring(0, 60)}...`,
      );
    });

    if (chunks.length === 0) {
      console.warn('  ⚠️  未返回任何 chunk — 可能 similarity_threshold 过高，或解析/嵌入异常');
    }

    // 7. 清理
    console.log('\n[7/7] 清理测试数据...');
    await ragflow.deleteDataset(datasetId);
    datasetId = null;
    console.log('  ✅ 已删除测试 dataset');

    console.log('\n' + '='.repeat(60));
    console.log('🎉 所有连通性测试通过！RAGFlow 配置正确。');
    console.log('='.repeat(60));
  } catch (err) {
    console.error('\n❌ 测试失败:', err);
    // 清理残留
    if (datasetId) {
      try {
        await ragflow.deleteDataset(datasetId);
        console.log('  已清理残留 dataset');
      } catch {}
    }
    process.exit(1);
  }
}

main();
