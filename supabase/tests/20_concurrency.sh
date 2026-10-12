#!/usr/bin/env bash
# Concurrency tests: run against a database that already has 0001_core.sql applied.
# usage: DB=tk_conc PSQL="psql" ./20_concurrency.sh
set -euo pipefail
PSQL="${PSQL:-psql}"; DB="${DB:-tk_conc}"
q() { $PSQL -X -q -At -d "$DB" -c "$1"; }

ADMIN=$(q "insert into auth.users (email) values ('cadmin@t.test') returning id")
U=$(q "insert into auth.users (email) values ('cuser@t.test') returning id")
q "update public.profiles set role='admin' where id='$ADMIN'"
P=$(q "insert into public.products_cache (provider_code,name,cost_price,margin) values ('C1','Conc',9000,1000) returning id")
q "select public.admin_manual_topup('$ADMIN','$U',100000,'conc-seed-0001','seed')" >/dev/null

echo "== A: 20 parallel checkouts with the SAME idempotency key => exactly 1 debit"
for i in $(seq 1 20); do q "select out_outcome from public.reserve_balance_and_create_transaction('$U','$P','081234567890','conc-idem-0001')" & done | sort | uniq -c
wait
[ "$(q "select saldo from public.profiles where id='$U'")" = "90000" ] || { echo "FAIL A balance"; exit 1; }

echo "== B: 20 parallel FAILED callbacks for one tx => exactly 1 refund"
REFF=$(q "select reff_id from public.transactions where user_id='$U'")
for i in $(seq 1 20); do q "select out_outcome from public.finalize_transaction_failed('$REFF','dup')" & done | sort | uniq -c
wait
[ "$(q "select saldo from public.profiles where id='$U'")" = "100000" ] || { echo "FAIL B balance"; exit 1; }
[ "$(q "select count(*) from public.balance_ledger where type='REFUND' and user_id='$U'")" = "1" ] || { echo "FAIL B refund rows"; exit 1; }

echo "== C: SUCCESS and FAILED racing for one tx => one winner, at most one refund, no corruption"
T=$(q "select out_reff_id from public.reserve_balance_and_create_transaction('$U','$P','081234567890','conc-idem-0002')")
( for i in 1 2 3 4 5 6 7 8; do q "select out_outcome from public.finalize_transaction_success('$T')" & q "select out_outcome from public.finalize_transaction_failed('$T')" & done; wait ) | sort | uniq -c
FINAL=$(q "select status from public.transactions where reff_id='$T'")
REFUNDS=$(q "select count(*) from public.balance_ledger l join public.transactions t on t.id=l.transaction_id where t.reff_id='$T' and l.type='REFUND'")
SALDO=$(q "select saldo from public.profiles where id='$U'")
echo "final=$FINAL refunds=$REFUNDS saldo=$SALDO"
if [ "$FINAL" = "SUCCESS" ]; then [ "$REFUNDS" = 0 ] && [ "$SALDO" = 90000 ] || { echo "FAIL C success"; exit 1; }
else [ "$REFUNDS" = 1 ] && [ "$SALDO" = 100000 ] || { echo "FAIL C failed"; exit 1; }; fi

echo "== D: 15 parallel checkouts (distinct keys) with balance for only 3 => exactly 3 succeed, saldo never negative"
V=$(q "insert into auth.users (email) values ('cpoor@t.test') returning id")
q "select public.admin_manual_topup('$ADMIN','$V',30000,'conc-seed-0002','seed')" >/dev/null
for i in $(seq 1 15); do q "select out_outcome from public.reserve_balance_and_create_transaction('$V','$P','081234567890','conc-d-key-$i')" & done | sort | uniq -c
wait
[ "$(q "select saldo from public.profiles where id='$V'")" = "0" ] || { echo "FAIL D balance"; exit 1; }

echo "== E: RECOVERY-SEND: reserved tx (provider_attempts=0), 25 parallel claims => exactly ONE may send /trx"
W=$(q "insert into auth.users (email) values ('crecover@t.test') returning id")
q "select public.admin_manual_topup('$ADMIN','$W',50000,'conc-seed-0003','seed')" >/dev/null
R=$(q "select out_reff_id from public.reserve_balance_and_create_transaction('$W','$P','081234567890','conc-recover-01')")
[ "$(q "select provider_attempts from public.transactions where reff_id='$R'")" = "0" ] || { echo "FAIL E precondition"; exit 1; }
for i in $(seq 1 25); do q "select out_claimed || ' ' || (out_reff_id = '$R') || ' attempts=' || out_attempts from public.claim_provider_send('$R')" & done | sort | uniq -c
wait
[ "$(q "select provider_attempts from public.transactions where reff_id='$R'")" = "1" ] || { echo "FAIL E attempts != 1"; exit 1; }
WON=$(for i in $(seq 1 25); do q "select out_claimed from public.claim_provider_send('$R')" & done | grep -c '^t$' || true); wait
[ "$WON" = "0" ] || { echo "FAIL E: a late claim still won"; exit 1; }

echo "== F: two admins demote each other at the same time => at least one admin always remains"
A1=$(q "insert into auth.users (email) values ('cadm1@t.test') returning id"); A2=$(q "insert into auth.users (email) values ('cadm2@t.test') returning id")
q "update public.profiles set role='admin' where id in ('$A1','$A2')"
q "update public.profiles set role='user' where id='$ADMIN'"
( q "select out_outcome from public.admin_set_user_flags('$A1','$A2','{\"role\":\"user\"}')" 2>&1 | tail -1 & q "select out_outcome from public.admin_set_user_flags('$A2','$A1','{\"role\":\"user\"}')" 2>&1 | tail -1 & wait ) | sort | uniq -c
[ "$(q "select count(*) from public.profiles where role='admin' and is_active")" -ge 1 ] || { echo "FAIL F: no admin left"; exit 1; }

echo "== G: TOP-UP: the SAME bank transaction reported 25x in parallel => credited exactly once"
ADM2=$(q "insert into auth.users (email) values ('ctopadm@t.test') returning id"); q "update public.profiles set role='admin' where id='$ADM2'"
q "select public.admin_update_settings('$ADM2','{\"topup_enabled\":true}')" >/dev/null
q "select public.admin_upsert_topup_bank('$ADM2','BRI','Bank BRI','1234567890','Pemilik Test',true)" >/dev/null
T1=$(q "insert into auth.users (email) values ('ctop1@t.test') returning id")
RQ=$(q "select out_request_id || '|' || out_total_amount from public.create_topup_request('$T1','BRI',100000,'conc-top-0001')")
RID=${RQ%%|*}; TOT=${RQ##*|}
for i in $(seq 1 25); do q "select out_outcome from public.record_incoming_transfer('BRI',$TOT,'CONC-REF-1',now(),null)" & done | sort | uniq -c
wait
[ "$(q "select saldo from public.profiles where id='$T1'")" = "$TOT" ] || { echo "FAIL G: balance is not exactly one credit"; exit 1; }
[ "$(q "select count(*) from public.balance_ledger where type='TOPUP' and user_id='$T1'")" = "1" ] || { echo "FAIL G: ledger rows"; exit 1; }

echo "== H: TOP-UP: two DIFFERENT bank transactions with the same amount for one request => one credit, one queued"
T2=$(q "insert into auth.users (email) values ('ctop2@t.test') returning id")
RQ2=$(q "select out_request_id || '|' || out_total_amount from public.create_topup_request('$T2','BRI',150000,'conc-top-0002')")
TOT2=${RQ2##*|}
for i in $(seq 1 12); do q "select out_outcome from public.record_incoming_transfer('BRI',$TOT2,'CONC-REF-H-$i',now(),null)" & done | sort | uniq -c
wait
[ "$(q "select saldo from public.profiles where id='$T2'")" = "$TOT2" ] || { echo "FAIL H: double credit"; exit 1; }
[ "$(q "select count(*) from public.topup_transfers where status='QUEUED' and amount=$TOT2")" = "11" ] || { echo "FAIL H: expected 11 queued"; exit 1; }

echo "== I: TOP-UP: admin confirm racing the automatic match for one request => one credit"
T3=$(q "insert into auth.users (email) values ('ctop3@t.test') returning id")
RQ3=$(q "select out_request_id || '|' || out_total_amount from public.create_topup_request('$T3','BRI',120000,'conc-top-0003')")
RID3=${RQ3%%|*}; TOT3=${RQ3##*|}
( q "select out_outcome from public.record_incoming_transfer('BRI',$TOT3,'CONC-REF-I',now(),null)" & q "select out_outcome from public.admin_confirm_topup_request('$ADM2','$RID3','konfirmasi manual')" & wait ) | sort | uniq -c
[ "$(q "select saldo from public.profiles where id='$T3'")" = "$TOT3" ] || { echo "FAIL I: double credit"; exit 1; }

echo "== J: TOP-UP: 30 users request the same base amount at once => every pending nominal is unique"
for i in $(seq 1 30); do
  U=$(q "insert into auth.users (email) values ('cj$i@t.test') returning id")
  q "select out_outcome from public.create_topup_request('$U','BRI',200000,'conc-j-key-$i')" & done | sort | uniq -c
wait
[ "$(q "select count(*) - count(distinct total_amount) from public.topup_requests where status='PENDING' and base_amount=200000")" = "0" ] || { echo "FAIL J: duplicate pending nominal"; exit 1; }

echo "== K: RATE LIMITER: 40 parallel hits on one key with limit 10 => exactly 10 allowed"
for i in $(seq 1 40); do q "select out_allowed from public.rate_limit_hit('conc-rl-key', 10, 3600)" & done | sort | uniq -c
wait
[ "$(q "select hits from public.rate_limits where key='conc-rl-key'")" = "40" ] || { echo "FAIL K: hits were lost (not atomic)"; exit 1; }

echo "== L: ADMIN CAP: 10 parallel manual credits of 30000 by ONE admin with a 100000/day cap => exactly 3 succeed"
LADM=$(q "insert into auth.users (email) values ('ccapadm@t.test') returning id"); q "update public.profiles set role='admin' where id='$LADM'"
LU=$(q "insert into auth.users (email) values ('ccapuser@t.test') returning id")
q "select public.admin_update_settings('$LADM','{\"admin_credit_daily_cap\":100000}')" >/dev/null
for i in $(seq 1 10); do q "select out_outcome from public.admin_manual_topup('$LADM','$LU',30000,'conc-cap-key-$i','x')" 2>&1 | tail -1 | cut -c1-40 & done | sort | uniq -c
wait
[ "$(q "select saldo from public.profiles where id='$LU'")" = "90000" ] || { echo "FAIL L: cap was not atomic"; exit 1; }

[ "$(q "select count(*) from public.find_balance_mismatches()")" = "0" ] || { echo "FAIL ledger mismatch"; exit 1; }
echo "ALL CONCURRENCY TESTS PASSED"
