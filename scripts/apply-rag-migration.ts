/**
 * Attach the vector + full-text columns to `document_chunks` with a
 * runtime-probed embedding dimension.
 *
 * The `document_chunks` table (scalar columns only) is created by the Prisma
 * init migration. This script:
 *   1. Probes the configured embedding endpoint to learn the true dim.
 *   2. Substitutes `{{DIM}}` in scripts/rag-chunks-table.sql.tmpl.
 *   3. Executes the resulting SQL against the configured Postgres.
 *   4. Writes `.rag-embedding-dim` as a breadcrumb for later sanity checks.
 *
 * Run once during initial setup (and again after changing embedding model):
 *   npx tsx scripts/apply-rag-migration.ts
 *
 * Requires env: DATABASE_URL, EMBEDDING_BASE_URL, EMBEDDING_API_KEY,
 * EMBEDDING_MODEL.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '../lib/server/db';

const TEMPLATE_FILE = path.join(process.cwd(), 'scripts/rag-chunks-table.sql.tmpl');
const DIM_MARKER_FILE = path.join(process.cwd(), '.rag-embedding-dim');

async function probeEmbeddingDim(): Promise<number> {
  const baseUrl = (process.env.EMBEDDING_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.EMBEDDING_API_KEY || '';
  const model = process.env.EMBEDDING_MODEL || 'qwen3-vl-embedding';

  if (!baseUrl) {
    throw new Error('EMBEDDING_BASE_URL is not set; cannot probe dimension.');
  }

  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, input: 'probe' }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Embedding probe failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
  const vec = json.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error('Embedding probe returned no vector.');
  }
  return vec.length;
}

async function existingEmbeddingDim(): Promise<number | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ atttypmod: number }>>(
    `SELECT a.atttypmod FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     WHERE c.relname = 'document_chunks' AND a.attname = 'embedding' AND a.attnum > 0`,
  );
  if (rows.length === 0) return null;
  return rows[0].atttypmod;
}

/**
 * Split a SQL file into statements, preserving PL/pgSQL `DO $$ ... $$` blocks.
 */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inDollar = false;
  const lines = sql.split('\n');
  for (const line of lines) {
    const stripped = line.replace(/--.*$/, '').trim();
    if (!stripped && !buf) continue;
    let rest = line;
    while (true) {
      const idx = rest.indexOf('$$');
      if (idx === -1) break;
      inDollar = !inDollar;
      rest = rest.slice(idx + 2);
    }
    buf += line + '\n';
    if (!inDollar && line.trim().endsWith(';')) {
      const stmt = buf.trim();
      if (stmt.length > 0) out.push(stmt);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out.filter((s) => s.replace(/--.*$/gm, '').trim().length > 0);
}

async function main() {
  console.log('Probing embedding endpoint for vector dimension...');
  const dim = await probeEmbeddingDim();
  console.log(`  detected dim = ${dim}`);

  const existing = await existingEmbeddingDim();
  if (existing !== null && existing !== dim) {
    throw new Error(
      `document_chunks.embedding has dim ${existing}, but probe returned ${dim}. ` +
        `Refusing to proceed. If you're intentionally changing embedding model, ` +
        `manually drop the column: ALTER TABLE document_chunks DROP COLUMN embedding CASCADE;`,
    );
  }

  const template = await fs.readFile(TEMPLATE_FILE, 'utf-8');
  const sql = template.replace(/{{DIM}}/g, String(dim));
  const statements = splitStatements(sql);

  console.log(`Executing ${statements.length} statement(s) against the database...`);
  for (const [i, stmt] of statements.entries()) {
    try {
      await prisma.$executeRawUnsafe(stmt);
      console.log(`  [${i + 1}/${statements.length}] ok`);
    } catch (err) {
      console.error(`  [${i + 1}/${statements.length}] FAILED:\n${stmt}\n`);
      throw err;
    }
  }

  await fs.writeFile(DIM_MARKER_FILE, String(dim) + '\n');
  console.log(`\nDone. Embedding dimension recorded in ${DIM_MARKER_FILE}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
