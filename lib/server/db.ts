import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Cap the pool to survive dev HMR reloads without exhausting Postgres
// connection slots. Production defaults to the pg library's `max: 10` unless
// `DB_POOL_MAX` is set (e.g. for horizontal scaling).
function resolvePoolMax(): number {
  const raw = process.env.DB_POOL_MAX;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return process.env.NODE_ENV === 'production' ? 10 : 5;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL environment variable is not set');
  return new Pool({ connectionString, max: resolvePoolMax() });
}

type PrismaGlobals = { prisma?: PrismaClient; pgPool?: Pool };
const g = globalThis as unknown as PrismaGlobals;

const pool = g.pgPool ?? createPool();
export const prisma = g.prisma ?? new PrismaClient({ adapter: new PrismaPg(pool) });

if (process.env.NODE_ENV !== 'production') {
  g.prisma = prisma;
  g.pgPool = pool;
}
