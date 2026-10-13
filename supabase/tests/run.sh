#!/usr/bin/env bash
# Runs the SQL suite against a throwaway local Postgres database (NOT your Supabase project).
# usage: PSQL="psql -U postgres" ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL="${PSQL:-psql}"
for DB in tk_test tk_conc; do
  $PSQL -X -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
  $PSQL -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/00_supabase_stub.sql
  for m in supabase/migrations/*.sql; do $PSQL -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$m"; done
  # suites 10..15 + concurrency insert users directly; the invite gate is switched on again in 16
  $PSQL -X -q -v ON_ERROR_STOP=1 -d "$DB" -c "alter table auth.users disable trigger enforce_invite_on_signup"
done
$PSQL -X -q -At -d tk_test -f supabase/tests/10_core_tests.sql
$PSQL -X -q -At -d tk_test -f supabase/tests/11_stage2_tests.sql
$PSQL -X -q -At -d tk_test -f supabase/tests/12_stage3_tests.sql
$PSQL -X -q -At -d tk_test -f supabase/tests/13_topup_tests.sql
$PSQL -X -q -At -d tk_test -f supabase/tests/14_hardening_tests.sql
$PSQL -X -q -At -d tk_test -f supabase/tests/15_ops_tests.sql
$PSQL -X -q -At -d tk_test -f supabase/tests/16_invite_tests.sql
$PSQL -X -q -At -d tk_test -f supabase/tests/17_bootstrap_tests.sql
$PSQL -X -q -At -d tk_test -f supabase/tests/18_diagnostics_tests.sql
PSQL="$PSQL" DB=tk_conc bash supabase/tests/20_concurrency.sh
