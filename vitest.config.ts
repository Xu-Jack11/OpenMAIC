import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    env: {
      // Some modules (e.g. `lib/server/db.ts`) eagerly construct a Prisma
      // client at import time. Tests never actually query the database, but
      // they still need a syntactically-valid connection string so module
      // initialization doesn't throw.
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test?schema=public',
    },
  },
});
