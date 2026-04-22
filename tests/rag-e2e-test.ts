/**
 * RAG End-to-End Test (self-hosted pgvector).
 *
 * Exercises the full pipeline:
 *   upload → index → retrieve → context build → reindex → cleanup.
 *
 * Requires a running Postgres (with pgvector) and the vLLM embedding/rerank
 * endpoints. MinerU is optional — non-PDF documents fall back to local
 * parsers, so this test deliberately uses a .txt file to keep requirements
 * minimal.
 *
 * Required env: DATABASE_URL, EMBEDDING_BASE_URL.
 *
 *   npx tsx tests/rag-e2e-test.ts
 */
import { prisma } from '../lib/server/db';
import {
  indexDocument,
  buildDocumentContext,
  reindexDocument,
  deleteDocumentImages,
} from '../lib/rag';
import { promises as fs } from 'fs';
import path from 'path';

const TEST_IDS = {
  user: 'rag-test-user',
  course: 'rag-test-course',
  doc: 'rag-test-doc',
};

async function cleanup() {
  await deleteDocumentImages(TEST_IDS.course, TEST_IDS.doc).catch(() => {});
  await prisma.document.deleteMany({ where: { id: TEST_IDS.doc } }).catch(() => {});
  await prisma.courseMember.deleteMany({ where: { courseId: TEST_IDS.course } }).catch(() => {});
  await prisma.course.deleteMany({ where: { id: TEST_IDS.course } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: TEST_IDS.user } }).catch(() => {});
}

async function main() {
  if (!process.env.EMBEDDING_BASE_URL) {
    console.error('ERROR: EMBEDDING_BASE_URL must be set');
    process.exit(1);
  }

  await cleanup();

  // 1. Create test user / course / document ------------------------------
  console.log('=== Step 1: Seed test data ===');
  const user = await prisma.user.create({
    data: { id: TEST_IDS.user, name: 'RAG Tester' },
  });
  const course = await prisma.course.create({
    data: {
      id: TEST_IDS.course,
      name: 'RAG Test Course',
      creator: { connect: { id: user.id } },
    },
  });

  const content = [
    '人工智能(Artificial Intelligence, AI)是计算机科学的一个分支,旨在开发能够模拟人类智能的系统。',
    '机器学习是人工智能的核心技术之一,通过大量数据训练模型来完成特定任务。',
    '深度学习是机器学习的一个子集,使用多层神经网络来学习数据的复杂表示。',
    '自然语言处理(NLP)使计算机能够理解、解释和生成人类语言。',
    '大语言模型(LLM)如 GPT 和 Claude,通过海量文本数据预训练,展现出强大的语言理解和生成能力。',
  ].join('\n');

  const docDir = path.join(process.cwd(), 'data', 'documents', TEST_IDS.course);
  await fs.mkdir(docDir, { recursive: true });
  const filePath = path.join(docDir, `${TEST_IDS.doc}.txt`);
  await fs.writeFile(filePath, content, 'utf-8');

  const doc = await prisma.document.create({
    data: {
      id: TEST_IDS.doc,
      course: { connect: { id: course.id } },
      name: 'AI简介.txt',
      storagePath: `data/documents/${TEST_IDS.course}/${TEST_IDS.doc}.txt`,
      mimeType: 'text/plain',
      sizeBytes: Buffer.byteLength(content),
      uploader: { connect: { id: user.id } },
      indexStatus: 'pending',
    },
  });
  console.log('  seeded user, course, document, file');

  // 2. Index -------------------------------------------------------------
  console.log('\n=== Step 2: indexDocument ===');
  const result = await indexDocument(doc.id);
  console.log(
    `  status=${result.status}, chunks=${result.chunksCreated}, error=${result.error || 'none'}`,
  );
  if (result.status !== 'indexed') {
    throw new Error(`Indexing did not succeed: ${result.error}`);
  }
  if (result.chunksCreated === 0) {
    throw new Error('Indexing succeeded but produced 0 chunks');
  }

  // 3. Retrieve ----------------------------------------------------------
  console.log('\n=== Step 3: buildDocumentContext (query: "什么是深度学习?") ===');
  const context = await buildDocumentContext({
    courseId: course.id,
    query: '什么是深度学习?',
    topK: 3,
    maxTokens: 2000,
  });
  if (!context) throw new Error('Retrieval returned null');
  console.log(
    `  chunks=${context.totalChunks}, sources=${context.sources.length}, truncated=${context.truncated}`,
  );
  console.log(`  preview: ${context.text.slice(0, 160)}...`);
  if (context.totalChunks === 0) {
    throw new Error('Retrieval returned zero chunks');
  }

  // 4. Re-index ----------------------------------------------------------
  console.log('\n=== Step 4: reindexDocument ===');
  const reindexResult = await reindexDocument(doc.id);
  console.log(`  status=${reindexResult.status}, chunks=${reindexResult.chunksCreated}`);
  if (reindexResult.status !== 'indexed') {
    throw new Error(`Reindex failed: ${reindexResult.error}`);
  }

  // 5. Cleanup -----------------------------------------------------------
  console.log('\n=== Step 5: Cleanup ===');
  await cleanup();
  await fs.rm(docDir, { recursive: true, force: true }).catch(() => {});
  console.log('  done.');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('\nERROR:', err);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
