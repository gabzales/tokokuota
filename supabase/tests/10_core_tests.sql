-- Behavioural tests for 0001_core.sql. Run against a scratch database (see supabase/tests/run.sh).
-- Every block raises on failure; ON_ERROR_STOP aborts the run.
\set ON_ERROR_STOP on

create function pg_temp.mk_user(p_email text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into auth.users (email) values (p_email) returning id into v;
  return v;
end $$;

-- Fixtures -------------------------------------------------------------
create temp table fx (k text primary key, v text);
grant all on fx to public;

do $$
declare
  v_admin uuid := pg_temp.mk_user('admin@t.test');
  v_u1 uuid := pg_temp.mk_user('u1@t.test');
  v_prod uuid; v_off uuid;
begin
  update public.profiles set role = 'admin' where id = v_admin;
  insert into public.products_cache (provider_code, name, category, cost_price, margin)
    values ('P10', 'Paket 10GB', 'data', 9000, 1000) returning id into v_prod;
  insert into public.products_cache (provider_code, name, cost_price, margin, is_available)
    values ('PX', 'Gangguan', 5000, 500, false) returning id into v_off;
  insert into fx values ('admin', v_admin), ('u1', v_u1), ('prod', v_prod), ('off', v_off);
  perform public.admin_manual_topup(v_admin, v_u1, 50000, 'topup-seed-0001', 'seed');
  assert (select saldo from public.profiles where id = v_u1) = 50000, 'seed balance';
  assert (select sell_price from public.products_cache where id = v_prod) = 10000, 'sell_price = cost + margin';
end $$;

-- T1/T2: reserve debits once; same idempotency key never debits twice ---------
do $$
declare
  u uuid := (select v::uuid from fx where k = 'u1');
  p uuid := (select v::uuid from fx where k = 'prod');
  r1 record; r2 record;
begin
  select * into r1 from public.reserve_balance_and_create_transaction(u, p, '081234567890', 'idem-key-0001');
  assert r1.out_outcome = 'CREATED' and r1.out_status = 'PENDING' and r1.out_amount = 10000, 'created pending';
  assert r1.out_balance_after = 40000, 'balance debited';
  select * into r2 from public.reserve_balance_and_create_transaction(u, p, '081234567890', 'idem-key-0001');
  assert r2.out_outcome = 'EXISTING' and r2.out_tx_id = r1.out_tx_id and r2.out_reff_id = r1.out_reff_id, 'same tx on retry';
  assert (select saldo from public.profiles where id = u) = 40000, 'no second debit';
  assert (select count(*) from public.balance_ledger where transaction_id = r1.out_tx_id and type = 'PURCHASE') = 1, 'one purchase row';
  insert into fx values ('tx1', r1.out_reff_id);
end $$;

-- T3/T4: rejections write nothing -------------------------------------------
do $$
declare
  u uuid := (select v::uuid from fx where k = 'u1');
  p uuid := (select v::uuid from fx where k = 'prod');
  o uuid := (select v::uuid from fx where k = 'off');
  poor uuid := pg_temp.mk_user('poor@t.test');
  n_tx int := (select count(*) from public.transactions);
begin
  assert (select out_outcome from public.reserve_balance_and_create_transaction(poor, p, '081234567890', 'idem-key-poor1')) = 'INSUFFICIENT_BALANCE';
  assert (select out_outcome from public.reserve_balance_and_create_transaction(u, o, '081234567890', 'idem-key-off01')) = 'PRODUCT_UNAVAILABLE';
  assert (select out_outcome from public.reserve_balance_and_create_transaction(u, gen_random_uuid(), '081234567890', 'idem-key-nop01')) = 'PRODUCT_UNAVAILABLE';
  assert (select out_outcome from public.reserve_balance_and_create_transaction(u, p, 'ab', 'idem-key-dst01')) = 'INVALID_DESTINATION';
  assert (select out_outcome from public.reserve_balance_and_create_transaction(gen_random_uuid(), p, '081234567890', 'idem-key-usr01')) = 'USER_NOT_FOUND';
  update public.profiles set is_active = false where id = poor;
  assert (select out_outcome from public.reserve_balance_and_create_transaction(poor, p, '081234567890', 'idem-key-ina01')) = 'USER_INACTIVE';
  assert (select count(*) from public.transactions) = n_tx, 'rejections create no transactions';
  assert (select saldo from public.profiles where id = u) = 40000, 'rejections do not move money';
end $$;

-- T5: failed => refund exactly once -----------------------------------------
do $$
declare
  u uuid := (select v::uuid from fx where k = 'u1');
  reff text := (select v from fx where k = 'tx1');
  a record; b record;
begin
  select * into a from public.finalize_transaction_failed(reff, 'gagal', '{"result":1}');
  select * into b from public.finalize_transaction_failed(reff, 'gagal lagi');
  assert a.out_outcome = 'APPLIED' and b.out_outcome = 'ALREADY_APPLIED', 'second failed is a no-op';
  assert (select saldo from public.profiles where id = u) = 50000, 'refunded once';
  assert (select count(*) from public.balance_ledger where type = 'REFUND' and transaction_id = a.out_tx_id) = 1, 'one refund row';
  -- a late SUCCESS after FAILED must not move money, only flag
  assert (select out_outcome from public.finalize_transaction_success(reff, 'late')) = 'CONFLICT';
  assert (select needs_review from public.transactions where reff_id = reff), 'flagged for review';
  assert (select status from public.transactions where reff_id = reff) = 'FAILED', 'status unchanged';
  assert (select saldo from public.profiles where id = u) = 50000, 'balance unchanged by conflict';
end $$;

-- T6/T7: success is final; late failure never refunds -------------------------
do $$
declare
  u uuid := (select v::uuid from fx where k = 'u1');
  p uuid := (select v::uuid from fx where k = 'prod');
  t record;
begin
  select * into t from public.reserve_balance_and_create_transaction(u, p, '081234567890', 'idem-key-0002');
  assert (select out_outcome from public.finalize_transaction_success(t.out_reff_id, 'SN123', '{"result":0}')) = 'APPLIED';
  assert (select out_outcome from public.finalize_transaction_success(t.out_reff_id)) = 'ALREADY_APPLIED';
  assert (select out_outcome from public.finalize_transaction_failed(t.out_reff_id, 'late fail')) = 'CONFLICT';
  assert (select saldo from public.profiles where id = u) = 40000, 'no refund after success';
  assert (select count(*) from public.balance_ledger where type = 'REFUND' and transaction_id = t.out_tx_id) = 0;
  assert (select out_outcome from public.finalize_transaction_failed('TKDOESNOTEXIST')) = 'NOT_FOUND';
  insert into fx values ('tx2', t.out_reff_id);
end $$;

-- T8: no way around the RPCs -----------------------------------------------
do $$
declare
  u uuid := (select v::uuid from fx where k = 'u1');
  reff text := (select v from fx where k = 'tx2');
  pending text;
begin
  begin update public.profiles set saldo = saldo + 1 where id = u; assert false, 'direct saldo update allowed';
  exception when insufficient_privilege then null; end;
  begin update public.transactions set status = 'FAILED' where reff_id = reff; assert false, 'terminal status flipped';
  exception when insufficient_privilege then null; end;
  begin update public.transactions set sell_price = 1 where reff_id = reff; assert false, 'price mutable';
  exception when insufficient_privilege then null; end;
  begin delete from public.transactions where reff_id = reff; assert false, 'tx deletable';
  exception when insufficient_privilege then null; end;
  begin update public.balance_ledger set amount = amount + 1; assert false, 'ledger mutable';
  exception when insufficient_privilege then null; end;
  begin delete from public.balance_ledger; assert false, 'ledger deletable';
  exception when insufficient_privilege then null; end;
  begin insert into public.balance_ledger (user_id, type, amount, balance_before, balance_after)
          values (u, 'ADJUSTMENT', 5, 40000, 40005); assert false, 'ledger insert outside RPC';
  exception when insufficient_privilege then null; end;
end $$;

-- T9: manual top-up -----------------------------------------------------------
do $$
declare
  admin uuid := (select v::uuid from fx where k = 'admin');
  u uuid := (select v::uuid from fx where k = 'u1');
  other uuid := pg_temp.mk_user('other@t.test');
  a record; b record;
begin
  select * into a from public.admin_manual_topup(admin, u, 7000, 'topup-key-0002', 'bonus');
  select * into b from public.admin_manual_topup(admin, u, 7000, 'topup-key-0002', 'bonus');
  assert a.out_outcome = 'APPLIED' and b.out_outcome = 'ALREADY_APPLIED' and a.out_ledger_id = b.out_ledger_id;
  assert (select saldo from public.profiles where id = u) = 47000, 'credited once';
  begin perform public.admin_manual_topup(u, u, 1000, 'topup-key-0003'); assert false, 'non-admin allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_manual_topup(admin, u, -5, 'topup-key-0004'); assert false, 'negative allowed';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_manual_topup(admin, other, 1000, 'topup-key-0002'); assert false, 'key reused for another user';
  exception when invalid_parameter_value then null; end;
end $$;

-- T10: privileges / RLS as an API client --------------------------------------
do $$
declare
  u uuid := (select v::uuid from fx where k = 'u1');
  other uuid := (select id from auth.users where email = 'other@t.test');
  n int;
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  set local role authenticated;

  select count(*) into n from public.profiles;                       assert n = 1, 'sees only own profile';
  select count(*) into n from public.transactions;                   assert n = 2, 'sees only own transactions';
  select count(*) into n from public.products_cache;                 assert n = 2, 'sees active products (unavailable ones stay listed, flagged is_available=false)';

  begin perform cost_price from public.products_cache; assert false, 'cost_price readable';
  exception when insufficient_privilege then null; end;
  begin perform provider_raw from public.transactions; assert false, 'provider_raw readable';
  exception when insufficient_privilege then null; end;
  begin update public.profiles set saldo = 999999 where id = u; assert false, 'saldo writable';
  exception when insufficient_privilege then null; end;
  begin update public.profiles set role = 'admin' where id = u; assert false, 'role writable';
  exception when insufficient_privilege then null; end;
  begin insert into public.transactions (user_id, reff_id, idempotency_key, provider_code, product_name, destination, cost_price, sell_price)
          values (u, 'X', 'idem-key-xxxx', 'P', 'P', '0812345', 1, 1); assert false, 'tx insertable';
  exception when insufficient_privilege then null; end;
  begin perform public.reserve_balance_and_create_transaction(u, gen_random_uuid(), '0812345', 'idem-key-api01'); assert false, 'rpc callable';
  exception when insufficient_privilege then null; end;
  begin perform public.finalize_transaction_failed('TKX'); assert false, 'finalize callable';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.provider_webhook_events; assert false, 'webhook log readable';
  exception when insufficient_privilege then null; end;

  update public.profiles set full_name = 'Budi' where id = u;        -- allowed
  reset role;
  assert (select full_name from public.profiles where id = u) = 'Budi';
  assert (select count(*) from public.profiles where id = other) = 1;
end $$;

-- T11: final integrity: saldo == sum(ledger) for everyone ---------------------
do $$
begin
  assert (select count(*) from public.find_balance_mismatches()) = 0, 'saldo matches ledger';
end $$;

select 'ALL SQL TESTS PASSED' as result;
