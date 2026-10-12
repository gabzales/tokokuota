-- Behavioural tests for 0002_stage2a.sql (run after 10_core_tests.sql on the same database).
\set ON_ERROR_STOP on

-- sync_products: inserts inactive, updates keep our margin / is_active ----------------
do $$
declare r record;
begin
  select * into r from public.sync_products('khfypay',
    '[{"provider_code":"S1","name":"Sync Satu","category":"data","cost_price":8000,"is_available":true,"raw":{"x":1}},
      {"provider_code":"S2","name":"Sync Dua","cost_price":3000}]'::jsonb, 500, false);
  assert r.out_inserted = 2 and r.out_updated = 0, 'two new products';
  assert not (select is_active from public.products_cache where provider_code = 'S1'), 'new products start inactive';
  assert (select margin from public.products_cache where provider_code = 'S1') = 500, 'default margin applied to new rows';

  update public.products_cache set margin = 1500, is_active = true where provider_code = 'S1';
  select * into r from public.sync_products('khfypay',
    '[{"provider_code":"S1","name":"Sync Satu v2","category":"data","cost_price":8200,"is_available":false}]'::jsonb, 0, true);
  assert r.out_inserted = 0 and r.out_updated = 1, 'existing product updated';
  assert (select margin from public.products_cache where provider_code = 'S1') = 1500, 'margin untouched by sync';
  assert (select is_active from public.products_cache where provider_code = 'S1'), 'is_active untouched by sync';
  assert (select cost_price from public.products_cache where provider_code = 'S1') = 8200, 'cost updated';
  assert (select sell_price from public.products_cache where provider_code = 'S1') = 9700, 'sell_price follows cost + kept margin';
  assert not (select is_available from public.products_cache where provider_code = 'S1'), 'availability follows provider';

  begin perform public.sync_products('khfypay', '{"not":"array"}'::jsonb); assert false, 'non-array accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.sync_products('khfypay', '[{"provider_code":"BAD","name":"neg","cost_price":-5}]'::jsonb); assert false, 'negative cost accepted';
  exception when check_violation then null; end;
end $$;

-- PRICE_CHANGED: guard compares, DB price always wins ----------------------------------
do $$
declare
  u uuid := (select id from auth.users where email = 'u1@t.test');
  p uuid := (select id from public.products_cache where provider_code = 'P10');
  before_bal bigint := (select saldo from public.profiles where id = (select id from auth.users where email = 'u1@t.test'));
  r record;
begin
  select * into r from public.reserve_balance_and_create_transaction(u, p, '081234567890', 'idem-key-px001', 9999);
  assert r.out_outcome = 'PRICE_CHANGED' and r.out_amount = 10000, 'stale price rejected, current price returned';
  assert (select saldo from public.profiles where id = u) = before_bal, 'nothing debited on PRICE_CHANGED';
  select * into r from public.reserve_balance_and_create_transaction(u, p, '081234567890', 'idem-key-px001', 10000);
  assert r.out_outcome = 'CREATED' and r.out_amount = 10000, 'matching expected price proceeds';
  select * into r from public.reserve_balance_and_create_transaction(u, p, '081234567890', 'idem-key-px002');
  assert r.out_outcome = 'CREATED', 'guard is optional';
end $$;

-- users cannot read reff_id; can still read the rest ------------------------------------
do $$
declare u uuid := (select id from auth.users where email = 'u1@t.test');
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  set local role authenticated;
  begin perform reff_id from public.transactions; assert false, 'reff_id readable by users';
  exception when insufficient_privilege then null; end;
  perform id, product_name, destination, sell_price, status, created_at from public.transactions;
  begin perform public.sync_products('khfypay', '[]'::jsonb); assert false, 'sync callable by users';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

do $$ begin
  assert (select count(*) from public.find_balance_mismatches()) = 0, 'saldo matches ledger';
end $$;

select 'ALL STAGE 2A SQL TESTS PASSED' as result;
