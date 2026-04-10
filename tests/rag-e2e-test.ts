/**
 * RAG End-to-End Test
 * Tests: chunk → embed → store → retrieve using local Qwen3-Embedding model
 */
import { prisma } from '../lib/server/db';
import {
  generateEmbedding,
  generateEmbeddings,
  formatEmbeddingForStorage,
} from '../lib/rag/embeddings';
import { chunkDocument } from '../lib/rag/chunker';

const TEST_IDS = {
  user: 'rag-test-user',
  course: 'rag-test-course',
  doc: 'rag-test-doc',
};

async function cleanup() {
  await prisma.documentChunk.deleteMany({ where: { documentId: TEST_IDS.doc } }).catch(() => {});
  await prisma.document.deleteMany({ where: { id: TEST_IDS.doc } }).catch(() => {});
  await prisma.courseMember.deleteMany({ where: { courseId: TEST_IDS.course } }).catch(() => {});
  await prisma.course.deleteMany({ where: { id: TEST_IDS.course } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: TEST_IDS.user } }).catch(() => {});
}

async function main() {
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
  const doc = await prisma.document.create({
    data: {
      id: TEST_IDS.doc,
      course: { connect: { id: course.id } },
      name: 'AI简介.txt',
      storagePath: '/tmp/test-rag.txt',
      mimeType: 'text/plain',
      sizeBytes: 0,
      uploader: { connect: { id: user.id } },
      indexStatus: 'indexing',
    },
  });
  console.log('  Created user, course, document');

  // 2. Chunk
  console.log('\n=== Step 2: Chunk document ===');
  const content = [
    '人工智能（Artificial Intelligence，简称AI）是计算机科学的一个分支，旨在开发能够模拟人类智能的系统。',
    '机器学习是人工智能的核心技术之一，通过大量数据训练模型来完成特定任务。',
    '深度学习是机器学习的一个子集，使用多层神经网络来学习数据的复杂表示。',
    '自然语言处理（NLP）使计算机能够理解、解释和生成人类语言。',
    '大语言模型（LLM）如GPT和Claude，通过海量文本数据预训练，展现出强大的语言理解和生成能力。',
  ].join('\n');

  const chunks = chunkDocument(content, 'AI简介.txt', 'text');
  console.log(`  Created ${chunks.length} chunks`);
  for (const [i, c] of chunks.entries()) {
    console.log(`  [${i}] ${c.content.substring(0, 60)}...`);
  }

  // 3. Embed
  console.log('\n=== Step 3: Generate embeddings ===');
  const embeddings = await generateEmbeddings(chunks.map((c) => c.content));
  console.log(`  Generated ${embeddings.length} embeddings, dim=${embeddings[0].length}`);

  // 4. Store
  console.log('\n=== Step 4: Store chunks with embeddings ===');
  for (let i = 0; i < chunks.length; i++) {
    const embStr = formatEmbeddingForStorage(embeddings[i]);
    await prisma.$executeRawUnsafe(
      `INSERT INTO document_chunks (id, "documentId", content, embedding, "chunkIndex", metadata, "createdAt")
       VALUES ($1, $2, $3, $4::vector, $5, $6, NOW())`,
      `chunk-${i}`,
      doc.id,
      chunks[i].content,
      embStr,
      i,
      JSON.stringify(chunks[i].metadata || {}),
    );
  }
  await prisma.document.update({ where: { id: doc.id }, data: { indexStatus: 'indexed' } });
  console.log(`  Stored ${chunks.length} chunks`);

  // 5. Retrieve
  console.log('\n=== Step 5: Retrieve (query: "什么是深度学习") ===');
  const qEmb = await generateEmbedding('什么是深度学习');
  const results = await prisma.$queryRawUnsafe<Array<{ content: string; similarity: number }>>(
    `SELECT dc.content, 1 - (dc.embedding <=> $1::vector) as similarity
     FROM document_chunks dc JOIN documents d ON dc."documentId" = d.id
     WHERE d."courseId" = $2 AND dc.embedding IS NOT NULL
     ORDER BY dc.embedding <=> $1::vector LIMIT 3`,
    formatEmbeddingForStorage(qEmb),
    course.id,
  );

  console.log('\n  Retrieval Results:');
  for (const [i, r] of results.entries()) {
    console.log(`  [${i + 1}] similarity=${Number(r.similarity).toFixed(4)}`);
    console.log(`      ${r.content.substring(0, 80)}`);
  }

  // 6. Cleanup
  console.log('\n=== Cleanup ===');
  await cleanup();
  console.log('  Done! All test data removed.');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ERROR:', e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
