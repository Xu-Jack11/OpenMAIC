/**
 * RAGFlow Migration Script
 *
 * Migrates existing indexed documents from the local RAG system to RAGFlow.
 * For each course with documents:
 *   1. Creates a RAGFlow dataset
 *   2. Uploads each document file to RAGFlow
 *   3. Triggers parsing and waits for completion
 *   4. Updates local database records
 *
 * This script is idempotent — it skips documents that already have a ragflowDocumentId.
 *
 * Usage:
 *   npx tsx scripts/migrate-to-ragflow.ts
 *
 * Requires:
 *   RAGFLOW_BASE_URL and RAGFLOW_API_KEY environment variables
 *   DATABASE_URL for Prisma
 */

import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '../lib/server/db';
import * as ragflow from '../lib/rag/ragflow-client';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntilDone(
  datasetId: string,
  ragflowDocId: string,
  timeoutMs: number = 300_000,
): Promise<'DONE' | 'FAIL'> {
  const deadline = Date.now() + timeoutMs;
  let interval = 2000;

  while (Date.now() < deadline) {
    await sleep(interval);
    const status = await ragflow.getDocumentStatus(datasetId, ragflowDocId);
    if (status.run === 'DONE') return 'DONE';
    if (status.run === 'FAIL' || status.run === 'CANCEL') return 'FAIL';
    interval = Math.min(interval + 500, 5000);
  }

  return 'FAIL';
}

async function main() {
  console.log('=== RAGFlow Migration ===\n');

  if (!ragflow.isConfigured()) {
    console.error('ERROR: RAGFLOW_BASE_URL and RAGFLOW_API_KEY must be set');
    process.exit(1);
  }

  const healthy = await ragflow.healthCheck();
  if (!healthy) {
    console.error('ERROR: RAGFlow is not reachable');
    process.exit(1);
  }

  console.log('RAGFlow connection verified.\n');

  // Find all courses that have documents
  const courses = await prisma.course.findMany({
    where: { documents: { some: {} } },
    include: {
      documents: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  console.log(`Found ${courses.length} course(s) with documents.\n`);

  let totalDocs = 0;
  let successDocs = 0;
  let skippedDocs = 0;
  let failedDocs = 0;

  for (const course of courses) {
    console.log(`\n--- Course: ${course.name} (${course.id}) ---`);
    console.log(`  Documents: ${course.documents.length}`);

    // 1. Ensure RAGFlow dataset
    let datasetId = course.ragflowDatasetId;
    if (!datasetId) {
      try {
        datasetId = await ragflow.createDataset(course.name);
        await prisma.course.update({
          where: { id: course.id },
          data: { ragflowDatasetId: datasetId },
        });
        console.log(`  Created RAGFlow dataset: ${datasetId}`);
      } catch (err) {
        console.error(`  FAILED to create dataset: ${err}`);
        failedDocs += course.documents.length;
        continue;
      }
    } else {
      console.log(`  Using existing RAGFlow dataset: ${datasetId}`);
    }

    // 2. Process each document
    for (const doc of course.documents) {
      totalDocs++;

      // Skip if already migrated
      if (doc.ragflowDocumentId) {
        console.log(`  [SKIP] ${doc.name} — already in RAGFlow (${doc.ragflowDocumentId})`);
        skippedDocs++;
        continue;
      }

      // Check if file exists on disk
      const filePath = path.join(process.cwd(), doc.storagePath);
      try {
        await fs.access(filePath);
      } catch {
        console.log(`  [FAIL] ${doc.name} — file not found: ${doc.storagePath}`);
        await prisma.document.update({
          where: { id: doc.id },
          data: { indexStatus: 'failed', indexError: 'File not found during migration' },
        });
        failedDocs++;
        continue;
      }

      try {
        // Upload
        const fileBuffer = await fs.readFile(filePath);
        const ragflowDocId = await ragflow.uploadDocument(datasetId, fileBuffer, doc.name);
        await prisma.document.update({
          where: { id: doc.id },
          data: { ragflowDocumentId: ragflowDocId, indexStatus: 'indexing' },
        });

        // Trigger parsing
        await ragflow.startParsing(datasetId, [ragflowDocId]);

        // Poll for completion
        const status = await pollUntilDone(datasetId, ragflowDocId);

        if (status === 'DONE') {
          await prisma.document.update({
            where: { id: doc.id },
            data: { indexStatus: 'indexed', indexError: null },
          });
          console.log(`  [OK]   ${doc.name}`);
          successDocs++;
        } else {
          await prisma.document.update({
            where: { id: doc.id },
            data: { indexStatus: 'failed', indexError: 'RAGFlow parsing failed during migration' },
          });
          console.log(`  [FAIL] ${doc.name} — RAGFlow parsing failed`);
          failedDocs++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await prisma.document.update({
          where: { id: doc.id },
          data: { indexStatus: 'failed', indexError: `Migration error: ${msg}` },
        });
        console.log(`  [FAIL] ${doc.name} — ${msg}`);
        failedDocs++;
      }
    }
  }

  console.log('\n=== Migration Summary ===');
  console.log(`  Total documents:  ${totalDocs}`);
  console.log(`  Successful:       ${successDocs}`);
  console.log(`  Skipped (exists): ${skippedDocs}`);
  console.log(`  Failed:           ${failedDocs}`);

  if (failedDocs > 0) {
    console.log('\nFailed documents can be retried via the UI "Retry Indexing" button.');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ERROR:', e);
  await prisma.$disconnect();
  process.exit(1);
});
