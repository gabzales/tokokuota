-- Behavioural tests for 0003_stage3.sql (run after 10 and 11 on the same database).
\set ON_ERROR_STOP on

create temp table fx3 (k text primary key, v text);
grant all on fx3 to public;

-- Fixtures ------------------------------------------------------------------------------
do $$
declare
  v_admin uuid := (select id from auth.users where email = 'admin@t.test');
  v_user  uuid;
  v_prod  uuid;
begin
  insert into auth.users (email) values ('s3user@t.test') returning id into v_user;
  perform public.admin_manual_topup(v_admin, v_user, 100000, 'topup-s3-seed-01', 'seed');
  insert into public.products_cache (provider_code, name, category, cost_price, margin)
    values ('S3A', 'Stage3 Produk', 'data', 10000, 1000) returning id into v_prod;
  insert into fx3 values ('admin', v_admin), ('user', v_user), ('prod', v_prod);
end $$;

-- T1: claim_provider_send is a compare-and-set -----------------------------------------------
do $$
declare
  u uuid := (select v::uuid from fx3 where k = 'user');
  p uuid := (select v::uuid from fx3 where k = 'prod');
  t record; c1 record; c2 record;
begin
  select * into t from public.reserve_balance_and_create_transaction(u, p, '081234567890', 'idem-s3-claim-01');
  assert t.out_outcome = 'CREATED';
  assert (select provider_attempts from public.transactions where reff_id = t.out_reff_id) = 0, 'fresh tx not yet claimed';

  select * into c1 from public.claim_provider_send(t.out_reff_id);
  select * into c2 from public.claim_provider_send(t.out_reff_id);
  assert c1.out_claimed and c1.out_attempts = 1 and c1.out_reff_id = t.out_reff_id, 'first claim wins';
  assert not c2.out_claimed and c2.out_attempts = 1 and c2.out_tx_id = c1.out_tx_id and c2.out_reff_id = c1.out_reff_id,
         'second claim loses and still points at the same transaction';
  assert (select provider_submitted_at is not null from public.transactions where reff_id = t.out_reff_id);

  assert not (select out_claimed from public.claim_provider_send('TKDOESNOTEXIST0000')), 'unknown reff_id';
  assert (select out_tx_id from public.claim_provider_send('TKDOESNOTEXIST0000')) is null;

  -- a transaction that is already final can never be claimed
  select * into t from public.reserve_balance_and_create_transaction(u, p, '081234567890', 'idem-s3-claim-02');
  perform public.finalize_transaction_failed(t.out_reff_id, 'x');
  assert not (select out_claimed from public.claim_provider_send(t.out_reff_id)), 'final tx cannot be claimed';
  assert (select provider_attempts from public.transactions where reff_id = t.out_reff_id) = 0;
end $$;

-- T2: display_name is what the user sees on the transaction --------------------------------
do $$
declare
  admin uuid := (select v::uuid from fx3 where k = 'admin');
  u uuid := (select v::uuid from fx3 where k = 'user');
  p uuid := (select v::uuid from fx3 where k = 'prod');
  t record;
begin
  perform public.admin_update_product(admin, p, '{"display_name":"Paket Super 10GB"}');
  select * into t from public.reserve_balance_and_create_transaction(u, p, '081234567890', 'idem-s3-disp-001');
  assert (select product_name from public.transactions where reff_id = t.out_reff_id) = 'Paket Super 10GB';
end $$;

-- T3: admin_update_product ---------------------------------------------------------------------
do $$
declare
  admin uuid := (select v::uuid from fx3 where k = 'admin');
  u uuid := (select v::uuid from fx3 where k = 'user');
  p uuid := (select v::uuid from fx3 where k = 'prod');
  r record; n_audit bigint := (select count(*) from public.admin_audit_log);
begin
  select * into r from public.admin_update_product(admin, p,
    '{"margin":2500,"is_active":false,"display_category":"Kuota","sort_order":5,"description":"  hemat  "}');
  assert r.out_outcome = 'UPDATED' and r.out_sell_price = 12500, 'sell price follows margin';
  assert (select (margin, is_active, display_category, sort_order, description)
            from public.products_cache where id = p) = (2500::bigint, false, 'Kuota'::text, 5, 'hemat'::text);
  assert (select count(*) from public.admin_audit_log) = n_audit + 1, 'audited';
  assert (select details -> 'before' ->> 'margin' from public.admin_audit_log order by id desc limit 1) = '1000', 'audit keeps the before-state';

  -- blanks clear display metadata
  perform public.admin_update_product(admin, p, '{"display_name":"  ","description":null}');
  assert (select display_name is null and description is null from public.products_cache where id = p);

  assert (select out_outcome from public.admin_update_product(admin, gen_random_uuid(), '{"margin":1}')) = 'NOT_FOUND';
  begin perform public.admin_update_product(admin, p, '{"cost_price":1}'); assert false, 'provider-owned field changed';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_update_product(admin, p, '{}'); assert false, 'empty patch accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_update_product(admin, p, '{"margin":-1}'); assert false, 'negative margin';
  exception when check_violation then null; end;
  begin perform public.admin_update_product(u, p, '{"margin":1}'); assert false, 'non-admin allowed';
  exception when insufficient_privilege then null; end;

  -- provider sync must not touch ANY app-owned column
  perform public.admin_update_product(admin, p, '{"margin":3000,"is_active":true,"display_name":"Nama Kita","display_category":"Kuota","sort_order":9}');
  perform public.sync_products('khfypay', '[{"provider_code":"S3A","name":"Provider Rename","category":"x","cost_price":10500,"is_available":true}]'::jsonb, 0, true);
  assert (select (margin, is_active, display_name, display_category, sort_order)
            from public.products_cache where id = p) = (3000::bigint, true, 'Nama Kita'::text, 'Kuota'::text, 9),
         'sync preserved margin, is_active and display metadata';
  assert (select (name, cost_price, sell_price) from public.products_cache where id = p) = ('Provider Rename'::text, 10500::bigint, 13500::bigint);
end $$;

-- T4: bulk margin ---------------------------------------------------------------------------------
do $$
declare
  admin uuid := (select v::uuid from fx3 where k = 'admin');
  u uuid := (select v::uuid from fx3 where k = 'user');
  n int;
begin
  insert into public.products_cache (provider_code, name, category, cost_price, margin, is_active) values
    ('B1', 'Bulk 1', 'bulkcat', 10000, 0, true), ('B2', 'Bulk 2', 'bulkcat', 2550, 0, false),
    ('B3', 'Bulk free', 'bulkcat', 0, 5, true), ('B4', 'Other', 'othercat', 10000, 0, true);

  select out_updated into n from public.admin_bulk_set_margin(admin, 'PERCENT', 10, 'bulkcat', false);
  assert n = 2, 'percent applies to the category; the cost-0 product would end at sell price 0 and is skipped';
  assert (select margin from public.products_cache where provider_code = 'B1') = 1000;
  assert (select margin from public.products_cache where provider_code = 'B2') = 255, 'rounded up: ceil(2550*10/100)';
  assert (select margin from public.products_cache where provider_code = 'B3') = 5, 'skipped row unchanged';
  assert (select margin from public.products_cache where provider_code = 'B4') = 0, 'other categories untouched';

  select out_updated into n from public.admin_bulk_set_margin(admin, 'FLAT', 700, 'bulkcat', true);
  assert n = 2, 'only active products when asked';
  assert (select margin from public.products_cache where provider_code = 'B2') = 255, 'inactive product untouched';

  -- a product whose result would be sell price 0 is skipped, not fatal
  select out_updated into n from public.admin_bulk_set_margin(admin, 'FLAT', 0, 'bulkcat', false);
  assert n = 2, 'cost 0 + margin 0 skipped';
  assert (select margin from public.products_cache where provider_code = 'B3') = 700, 'skipped row unchanged';

  begin perform public.admin_bulk_set_margin(admin, 'WHATEVER', 1); assert false, 'bad mode';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_bulk_set_margin(admin, 'PERCENT', 5000); assert false, 'absurd percent';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_bulk_set_margin(u, 'FLAT', 1); assert false, 'non-admin allowed';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.admin_audit_log where action = 'bulk_set_margin') >= 3, 'audited';
end $$;

-- T5: user flags -------------------------------------------------------------------------------------
do $$
declare
  admin uuid := (select v::uuid from fx3 where k = 'admin');
  u uuid := (select v::uuid from fx3 where k = 'user');
begin
  assert (select out_outcome from public.admin_set_user_flags(admin, u, '{"is_active":false}')) = 'UPDATED';
  assert not (select is_active from public.profiles where id = u);
  assert (select out_outcome from public.reserve_balance_and_create_transaction(u, (select v::uuid from fx3 where k = 'prod'), '081234567890', 'idem-s3-inact-01')) = 'USER_INACTIVE';
  perform public.admin_set_user_flags(admin, u, '{"is_active":true,"role":"admin"}');
  assert (select role from public.profiles where id = u) = 'admin';
  perform public.admin_set_user_flags(admin, u, '{"role":"user"}');

  begin perform public.admin_set_user_flags(admin, admin, '{"role":"user"}'); assert false, 'self change';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_set_user_flags(admin, u, '{"role":"superuser"}'); assert false, 'bad role';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_set_user_flags(admin, u, '{"saldo":99}'); assert false, 'saldo via flags';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_set_user_flags(u, admin, '{"is_active":false}'); assert false, 'non-admin allowed';
  exception when insufficient_privilege then null; end;
  assert (select out_outcome from public.admin_set_user_flags(admin, gen_random_uuid(), '{"is_active":false}')) = 'NOT_FOUND';
  assert (select is_active and role = 'admin' from public.profiles where id = admin), 'admin untouched';
end $$;

-- T6: review queue ----------------------------------------------------------------------------------------
do $$
declare
  admin uuid := (select v::uuid from fx3 where k = 'admin');
  u uuid := (select v::uuid from fx3 where k = 'user');
  reff text := (select reff_id from public.transactions where needs_review limit 1);
begin
  assert reff is not null, 'a flagged transaction exists from earlier tests';
  begin perform public.admin_resolve_review(admin, reff, 'ab'); assert false, 'short note';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_resolve_review(u, reff, 'sudah dicek'); assert false, 'non-admin';
  exception when insufficient_privilege then null; end;
  assert (select out_outcome from public.admin_resolve_review(admin, reff, 'sudah dicek manual')) = 'RESOLVED';
  assert not (select needs_review from public.transactions where reff_id = reff);
  assert (select review_note like '%[resolved] sudah dicek manual%' from public.transactions where reff_id = reff), 'note appended, history kept';
  assert (select out_outcome from public.admin_resolve_review(admin, reff, 'sekali lagi')) = 'NOT_FLAGGED';
  assert (select out_outcome from public.admin_resolve_review(admin, 'TKNOPE', 'sekali lagi')) = 'NOT_FOUND';
end $$;

-- T7: settings + maintenance mode -----------------------------------------------------------------------------
do $$
declare
  admin uuid := (select v::uuid from fx3 where k = 'admin');
  u uuid := (select v::uuid from fx3 where k = 'user');
  p uuid := (select v::uuid from fx3 where k = 'prod');
  before_bal bigint := (select saldo from public.profiles where id = (select v::uuid from fx3 where k = 'user'));
  r record;
begin
  perform public.admin_update_settings(admin, '{"announcement":"Halo","support_contact":"wa.me/62812","catalog_default_margin":1500,"catalog_activate_new":true}');
  assert (select value from public.app_settings where key = 'announcement') = '"Halo"'::jsonb;
  assert (select value from public.app_settings where key = 'catalog_default_margin') = '1500'::jsonb;

  for r in select unnest(array[
      '{"nope":1}', '{"maintenance_mode":"yes"}', '{"catalog_default_margin":-1}', '{"catalog_default_margin":1.5}',
      '{"catalog_activate_new":1}', '{"support_contact":123}', '{}']) as c loop
    begin perform public.admin_update_settings(admin, r.c::jsonb); assert false, 'bad settings accepted: ' || r.c;
    exception when invalid_parameter_value then null; end;
  end loop;
  begin perform public.admin_update_settings(admin, jsonb_build_object('announcement', repeat('x', 301))); assert false, 'long announcement';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_update_settings(u, '{"announcement":"x"}'); assert false, 'non-admin';
  exception when insufficient_privilege then null; end;

  -- maintenance blocks NEW purchases but repeats of an existing key still resolve
  perform public.admin_update_settings(admin, '{"maintenance_mode":true}');
  select * into r from public.reserve_balance_and_create_transaction(u, p, '081234567890', 'idem-s3-maint-01');
  assert r.out_outcome = 'MAINTENANCE', 'maintenance blocks';
  assert (select saldo from public.profiles where id = u) = before_bal, 'nothing debited';
  assert (select out_outcome from public.reserve_balance_and_create_transaction(u, p, '081234567890', 'idem-s3-claim-01')) = 'EXISTING', 'existing key unaffected';
  perform public.admin_update_settings(admin, '{"maintenance_mode":false}');
  assert (select out_outcome from public.reserve_balance_and_create_transaction(u, p, '081234567890', 'idem-s3-maint-01')) = 'CREATED', 'works again after maintenance';
end $$;

-- T8: manual top-up is audited, capped, still idempotent ----------------------------------------------------------
do $$
declare
  admin uuid := (select v::uuid from fx3 where k = 'admin');
  u uuid := (select v::uuid from fx3 where k = 'user');
  n bigint := (select count(*) from public.admin_audit_log where action = 'manual_topup');
begin
  perform public.admin_manual_topup(admin, u, 5000, 'topup-s3-aud-001', 'audit me');
  perform public.admin_manual_topup(admin, u, 5000, 'topup-s3-aud-001', 'audit me');
  assert (select count(*) from public.admin_audit_log where action = 'manual_topup') = n + 1, 'one audit row, replay adds none';
  begin perform public.admin_manual_topup(admin, u, 1000000001, 'topup-s3-big-001'); assert false, 'cap';
  exception when invalid_parameter_value then null; end;
end $$;

-- T9: read RPCs (as service_role) ---------------------------------------------------------------------------------------
do $$
declare
  u uuid := (select v::uuid from fx3 where k = 'user');
  st jsonb; n int;
begin
  -- an unsent and a stale transaction (backdate with the guard off; only this test does that)
  alter table public.transactions disable trigger transactions_guard_trg;
  update public.transactions set created_at = now() - interval '30 minutes'
   where reff_id = (select reff_id from public.transactions where user_id = u and provider_attempts = 0 and status = 'PENDING' order by created_at limit 1);
  update public.transactions set created_at = now() - interval '30 minutes'
   where reff_id = (select reff_id from public.transactions where user_id = u and provider_attempts = 1 and status = 'PENDING' limit 1);
  alter table public.transactions enable trigger transactions_guard_trg;

  set local role service_role;

  select count(*) into n from public.admin_list_transactions(p_unsent => true);
  assert n >= 1, 'unsent listed';
  select count(*) into n from public.admin_list_transactions(p_stale => true);
  assert n >= 1, 'stale listed';
  select count(*) into n from public.admin_list_transactions(p_unsent => true, p_user_id => gen_random_uuid());
  assert n = 0, 'user filter applies';
  select count(*) into n from public.admin_list_transactions(p_status => 'FAILED');
  assert n >= 1;
  select count(*) into n from public.admin_list_transactions(p_search => 'Paket Super');
  assert n >= 1, 'search by product name';
  select count(*) into n from public.admin_list_transactions(p_search => 's3user@t');
  assert n >= 1, 'search by user email';

  -- LIKE metacharacters are literal
  select count(*) into n from public.admin_list_users(p_search => '%');
  assert n = 0, 'a bare % matches nothing instead of everything';
  select count(*) into n from public.admin_list_users(p_search => '_');
  assert n = 0, 'a bare _ matches nothing instead of everything';
  select count(*) into n from public.admin_list_users(p_search => 's3user@t.test');
  assert n = 1;
  select count(*) into n from public.admin_list_users(p_search => 'S3USER');
  assert n = 1, 'case-insensitive';
  select count(*) into n from public.admin_list_users(p_role => 'admin');
  assert n >= 1;
  select count(*) into n from public.admin_list_users(p_limit => 1000);
  assert n <= 101, 'limit clamped';

  select count(*) into n from public.admin_list_ledger(p_type => 'MANUAL_TOPUP');
  assert n >= 2;
  select count(*) into n from public.admin_list_ledger(p_type => 'REFUND', p_user_id => u);
  assert n >= 1;
  assert (select created_by_email from public.admin_list_ledger(p_type => 'MANUAL_TOPUP', p_user_id => u) limit 1) = 'admin@t.test';

  select count(*) into n from public.admin_list_products(p_search => 'S3A');
  assert n = 1, 'search by provider code';
  select count(*) into n from public.admin_list_products(p_category => 'bulkcat');
  assert n = 3;
  select count(*) into n from public.admin_list_audit();
  assert n >= 5;
  select count(*) into n from public.admin_list_webhook_events();
  assert n >= 0;

  st := public.admin_dashboard_stats(now() - interval '1 day');
  assert (st ->> 'users_total')::int >= 3, 'stats: users';
  assert (st ->> 'unsent')::int >= 1 and (st ->> 'stale_pending')::int >= 1, 'stats: monitoring counters';
  assert st ? 'since_revenue' and st ? 'since_profit' and st ? 'webhook_unresolved_24h' and st ? 'needs_review';
  reset role;
end $$;

-- T10: nothing new is reachable from the API roles; audit log is immutable -------------------------------------------------------
do $$
declare
  admin uuid := (select v::uuid from fx3 where k = 'admin');
begin
  set local role authenticated;
  begin perform public.claim_provider_send('TKX'); assert false, 'claim callable by users';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_update_settings(admin, '{"announcement":"hack"}'); assert false, 'settings callable by users';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_dashboard_stats(now()); assert false, 'stats callable by users';
  exception when insufficient_privilege then null; end;
  begin perform * from public.admin_list_users(); assert false, 'user list callable by users';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.app_settings; assert false, 'settings readable by users';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.admin_audit_log; assert false, 'audit readable by users';
  exception when insufficient_privilege then null; end;
  reset role;

  set local role anon;
  begin perform * from public.admin_list_transactions(); assert false, 'anon can list transactions';
  exception when insufficient_privilege then null; end;
  reset role;

  begin update public.admin_audit_log set action = 'x'; assert false, 'audit mutable';
  exception when insufficient_privilege then null; end;
  begin delete from public.admin_audit_log; assert false, 'audit deletable';
  exception when insufficient_privilege then null; end;
  begin perform public.record_provider_attempt('TKX'); assert false, 'old unsafe attempt counter still exists';
  exception when undefined_function then null; end;
end $$;

do $$ begin
  assert (select count(*) from public.find_balance_mismatches()) = 0, 'saldo matches ledger';
end $$;

select 'ALL STAGE 3 SQL TESTS PASSED' as result;
