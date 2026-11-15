#!/usr/bin/env bash
# Database checks against a disposable PostgreSQL (CI service or local):
#   1. supabase/migrations apply cleanly to an empty database;
#   2. the integrity guard tests pass;
#   3. the generated supabase/setup.sql applies, re-applies, and produces
#      exactly the same schema as the migrations;
#   4. the TypeScript publish/quarantine integration tests pass.
# Uses the standard PG* variables (PGHOST, PGPORT, PGUSER, PGPASSWORD).
# Never point this at a real Supabase project: it creates and drops databases.
set -euo pipefail
cd "$(dirname "$0")/../.."

MIG=publicledger_test_migrations
SETUP=publicledger_test_setup
psql_q() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

for db in "$MIG" "$SETUP"; do
  psql_q -d postgres -c "drop database if exists $db" -c "create database $db" 2>/dev/null
  psql_q -d "$db" -f supabase/tests/supabase-stubs.sql
done

for file in supabase/migrations/*.sql; do
  psql_q -d "$MIG" -f "$file" >/dev/null 2>&1 || { echo "Migration failed: $file"; psql_q -d "$MIG" -f "$file"; exit 1; }
done
echo "✓ migrations apply"

psql_q -d "$MIG" -o /dev/null -f supabase/tests/integrity.test.sql 2>&1 | grep -v NOTICE
echo "✓ integrity guards"

psql_q -d "$SETUP" -f supabase/setup.sql >/dev/null 2>&1 || { psql_q -d "$SETUP" -f supabase/setup.sql; exit 1; }
psql_q -d "$SETUP" -f supabase/setup.sql >/dev/null 2>&1 || { echo "setup.sql is not re-runnable"; exit 1; }
dump() { pg_dump -d "$1" --schema-only --schema=public | grep -v -e '^--' -e '^\\restrict' -e '^\\unrestrict' | sed '/^$/d'; }
if ! diff <(dump "$MIG") <(dump "$SETUP") >/dev/null; then
  echo "supabase/setup.sql does not match the migrations:"; diff <(dump "$MIG") <(dump "$SETUP") | head -40; exit 1
fi
echo "✓ setup.sql matches the migrations and is re-runnable"

TEST_DATABASE_URL="postgresql://${PGUSER:-postgres}${PGPASSWORD:+:$PGPASSWORD}@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/$MIG" \
  pnpm exec vitest run tests/db
echo "✓ publish and quarantine integration tests"
