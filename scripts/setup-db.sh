#!/usr/bin/env bash
#
# Fresh-database bootstrap for OpenMAIC.
#
# Run on a new Postgres instance to:
#   1. (Optional) create the openmaic role + database via superuser.
#   2. Ensure the pgvector extension is installed and owned by openmaic.
#   3. Apply the Prisma init migration.
#   4. Attach the pgvector embedding column + HNSW/GIN indexes.
#
# Required env (loaded from .env.local if present):
#   DATABASE_URL          — postgresql://openmaic:<pw>@<host>:5432/openmaic
#   EMBEDDING_BASE_URL    — vLLM embedding endpoint used for dim probing
#
# Optional env:
#   SUPERUSER_URL         — postgresql://postgres@<host>:5432/postgres
#                           Used only for the extension-ownership fix below.
#                           If unset, you must transfer ownership manually.

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env.local ]]; then
  set -a; source .env.local; set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

if [[ -z "${EMBEDDING_BASE_URL:-}" ]]; then
  echo "ERROR: EMBEDDING_BASE_URL is not set" >&2
  exit 1
fi

echo "[setup-db] DATABASE_URL = ${DATABASE_URL}"

# ----- 1. pgvector extension ownership ----------------------------------------
# `CREATE EXTENSION vector` requires superuser privilege unless the role has
# CREATE on the database. The simplest safe approach: let a superuser create
# + transfer ownership once, then our role can manage it forever.
if [[ -n "${SUPERUSER_URL:-}" ]]; then
  echo "[setup-db] ensuring pgvector extension (via superuser)"
  psql "$SUPERUSER_URL" -v ON_ERROR_STOP=1 <<SQL
CREATE EXTENSION IF NOT EXISTS vector;
ALTER EXTENSION vector OWNER TO openmaic;
SQL
else
  echo "[setup-db] SUPERUSER_URL unset — skipping superuser steps."
  echo "[setup-db] If this is a brand-new DB, run these once as postgres:"
  echo "    CREATE EXTENSION IF NOT EXISTS vector;"
  echo "    ALTER EXTENSION vector OWNER TO openmaic;"
fi

# ----- 2. Apply Prisma migrations --------------------------------------------
echo "[setup-db] prisma migrate deploy"
npx prisma migrate deploy

# ----- 3. Generate Prisma client ---------------------------------------------
echo "[setup-db] prisma generate"
npx prisma generate

# ----- 4. Attach pgvector columns with probed dim ----------------------------
echo "[setup-db] apply-rag-migration.ts"
npx tsx scripts/apply-rag-migration.ts

echo "[setup-db] Done."
