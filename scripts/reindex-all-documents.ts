/**
 * Reindex All Documents
 *
 * One-shot migration helper: resets every document's indexStatus and
 * re-embeds it against the new pgvector-backed RAG pipeline.
 *
 * Use this after:
 *   - switching from RAGFlow to pgvector (embeddings could not be migrated)
 *   - changing EMBEDDING_MODEL or EMBEDDING_DIMENSIONS
 *   - changing chunk size / overlap
 *
 * Usage:
 *   npx tsx scripts/reindex-all-documents.ts          # all documents
 *   npx tsx scripts/reindex-all-documents.ts <courseId>  # one course
 *
 * Requires:
 *   DATABASE_URL, EMBEDDING_API_KEY (+ optional EMBEDDING_* overrides)
 */

import { prisma } from '../lib/server/db';
import { reindexDocument } from '../lib/rag';
import { isConfigured } from '../lib/rag/embedder';

async function main() {
  console.log('=== Reindex All Documents (pgvector) ===\n');

  if (!isConfigured()) {
    console.error('ERROR: EMBEDDING_API_KEY is not set.');
    process.exit(1);
  }

  const filterCourseId = process.argv[2];
  const where = filterCourseId ? { courseId: filterCourseId } : {};

  const documents = await prisma.document.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, courseId: true, indexStatus: true },
  });

  console.log(
    `Found ${documents.length} document(s)${filterCourseId ? ` in course ${filterCourseId}` : ''}.\n`,
  );

  let ok = 0;
  let failed = 0;

  for (const doc of documents) {
    process.stdout.write(`  [${doc.courseId}] ${doc.name} ... `);
    try {
      const result = await reindexDocument(doc.id);
      if (result.status === 'indexed') {
        console.log(`ok (${result.chunksCreated} chunks)`);
        ok++;
      } else {
        console.log(`FAILED (${result.error})`);
        failed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAILED (${msg})`);
      failed++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`  Total:   ${documents.length}`);
  console.log(`  Indexed: ${ok}`);
  console.log(`  Failed:  ${failed}`);

  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error('ERROR:', err);
  await prisma.$disconnect();
  process.exit(1);
});
