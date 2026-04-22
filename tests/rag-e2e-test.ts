/**
 * RAG End-to-End Test (pgvector)
 *
 * Tests the full in-process RAG pipeline:
 *   upload → parse → chunk → embed → pgvector hybrid retrieval → build context
 *
 * Requires:
 *   - Postgres with the `vector` extension and the migration
 *     `20260422120000_pgvector_rag` applied
 *   - EMBEDDING_API_KEY (and optional EMBEDDING_BASE_URL / EMBEDDING_MODEL)
 */
import { prisma } from '../lib/server/db';
import { indexDocument, buildDocumentContext, reindexDocument } from '../lib/rag';
import { isConfigured } from '../lib/rag/embedder';
import { promises as fs } from 'fs';
import path from 'path';

const TEST_IDS = {
  user: 'rag-test-user',
  course: 'rag-test-course',
  doc: 'rag-test-doc',
};

async function cleanup() {
  // FK cascades wipe document_chunks automatically.
  await prisma.document.deleteMany({ where: { id: TEST_IDS.doc } }).catch(() => {});
  await prisma.courseMember.deleteMany({ where: { courseId: TEST_IDS.course } }).catch(() => {});
  await prisma.course.deleteMany({ where: { id: TEST_IDS.course } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: TEST_IDS.user } }).catch(() => {});
}

async function main() {
  if (!isConfigured()) {
    console.error('ERROR: EMBEDDING_API_KEY must be set');
    process.exit(1);
  }

  await cleanup();

  // 1. Setup test data
  console.log('=== Step 1: Create test data ===');
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
    '人工智能（Artificial Intelligence，简称AI）是计算机科学的一个分支，旨在开发能够模拟人类智能的系统。',
    '机器学习是人工智能的核心技术之一，通过大量数据训练模型来完成特定任务。',
    '深度学习是机器学习的一个子集，使用多层神经网络来学习数据的复杂表示。',
    '自然语言处理（NLP）使计算机能够理解、解释和生成人类语言。',
    '大语言模型（LLM）如GPT和Claude，通过海量文本数据预训练，展现出强大的语言理解和生成能力。',
  ].join('\n');

  const testFileDir = path.join(process.cwd(), 'data', 'documents', TEST_IDS.course);
  await fs.mkdir(testFileDir, { recursive: true });
  const filePath = path.join(testFileDir, `${TEST_IDS.doc}.txt`);
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
  console.log('  Created user, course, document, test file');

  // 2. Index
  console.log('\n=== Step 2: Index document (pgvector) ===');
  const result = await indexDocument(doc.id);
  console.log(
    `  status=${result.status}, chunks=${result.chunksCreated}, error=${result.error || 'none'}`,
  );
  if (result.status !== 'indexed') {
    console.error('  ERROR: indexing failed');
    await cleanup();
    process.exit(1);
  }

  // 3. Retrieve
  console.log('\n=== Step 3: Retrieve (query: "什么是深度学习") ===');
  const context = await buildDocumentContext({
    courseId: course.id,
    query: '什么是深度学习',
    topK: 3,
    maxTokens: 2000,
  });

  if (context) {
    console.log(`  Retrieved ${context.totalChunks} chunks from ${context.sources.length} doc(s)`);
    console.log(`  Truncated: ${context.truncated}`);
    console.log(`  Context preview: ${context.text.substring(0, 200)}...`);
  } else {
    console.log('  No context returned');
  }

  // 4. Re-index
  console.log('\n=== Step 4: Re-index ===');
  const reindexResult = await reindexDocument(doc.id);
  console.log(`  Re-index result: status=${reindexResult.status}`);

  // 5. Cleanup
  console.log('\n=== Cleanup ===');
  await cleanup();
  await fs.rm(testFileDir, { recursive: true, force: true }).catch(() => {});
  console.log('  Done! All test data removed.');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ERROR:', e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
