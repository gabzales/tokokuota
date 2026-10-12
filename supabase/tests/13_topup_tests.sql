-- Behavioural tests for 0004_topup.sql (run after 10..12 on the same database).
\set ON_ERROR_STOP on

create temp table fx4 (k text primary key, v text);
grant all on fx4 to public;

create function pg_temp.mk4(p_email text) returns uuid language plpgsql as $$
declare v uuid; begin insert into auth.users (email) values (p_email) returning id into v; return v; end $$;

-- Fixtures --------------------------------------------------------------------------------------
do $$
declare admin uuid := (select id from auth.users where email = 'admin@t.test');
begin
  insert into fx4 values ('admin', admin::text), ('a', pg_temp.mk4('tu-a@t.test')::text), ('b', pg_temp.mk4('tu-b@t.test')::text),
                         ('c', pg_temp.mk4('tu-c@t.test')::text), ('plain', pg_temp.mk4('tu-plain@t.test')::text);
end $$;

-- T1: settings ------------------------------------------------------------------------------------
do $$
declare admin uuid := (select v::uuid from fx4 where k = 'admin'); u uuid := (select v::uuid from fx4 where k = 'plain'); r record;
begin
  assert (select value from public.app_settings where key = 'topup_enabled') = 'false'::jsonb, 'top-up is OFF by default';
  assert (select value from public.app_settings where key = 'topup_expiry_minutes') = '1440'::jsonb, '24h default';
  for r in select unnest(array['{"topup_min_amount":0}','{"topup_expiry_minutes":1}','{"topup_expiry_minutes":99999}','{"topup_code_max":10000}',
      '{"topup_enabled":"yes"}','{"topup_min_amount":1.5}','{"topup_max_amount":"x"}','{"topup_min_amount":3000000}','{"topup_code_min":900,"topup_code_max":10}']) as c loop
    begin perform public.admin_update_settings(admin, r.c::jsonb); assert false, 'accepted: ' || r.c;
    exception when invalid_parameter_value then null; end;
  end loop;
  assert (select value from public.app_settings where key = 'topup_min_amount') = '10000'::jsonb, 'failed updates rolled back';
  begin perform public.admin_update_settings(u, '{"topup_enabled":true}'); assert false, 'non-admin';
  exception when insufficient_privilege then null; end;
end $$;

-- T2: banks -----------------------------------------------------------------------------------------
do $$
declare admin uuid := (select v::uuid from fx4 where k = 'admin'); u uuid := (select v::uuid from fx4 where k = 'plain');
begin
  assert (select out_outcome from public.admin_upsert_topup_bank(admin, 'BRI', 'Bank BRI', '1234567890', 'Pemilik Test', false, 0)) = 'CREATED';
  assert (select out_outcome from public.admin_upsert_topup_bank(admin, 'BRI', 'Bank BRI', '1234567890', 'Pemilik Test', true, 0)) = 'UPDATED';
  begin perform public.admin_upsert_topup_bank(admin, 'bri x', 'Bank', '1234567890', 'Nama', true); assert false, 'bad code';
  exception when check_violation then null; end;
  begin perform public.admin_upsert_topup_bank(admin, 'BNI', 'Bank BNI', '12ab', 'Nama', true); assert false, 'bad account number';
  exception when check_violation then null; end;
  begin perform public.admin_upsert_topup_bank(u, 'BNI', 'Bank BNI', '1234567890', 'Nama', true); assert false, 'non-admin';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.admin_audit_log where action in ('create_topup_bank', 'update_topup_bank')) >= 2, 'audited';
end $$;

-- T3: create requests ----------------------------------------------------------------------------------
do $$
declare
  admin uuid := (select v::uuid from fx4 where k = 'admin');
  a uuid := (select v::uuid from fx4 where k = 'a'); b uuid := (select v::uuid from fx4 where k = 'b');
  r record; r2 record; saldo_before bigint := (select saldo from public.profiles where id = (select v::uuid from fx4 where k = 'a'));
  codes int[] := '{}'; i int;
begin
  assert (select out_outcome from public.create_topup_request(a, 'BRI', 50000, 'idem-t4-disabled')) = 'TOPUP_DISABLED', 'disabled by default';
  perform public.admin_update_settings(admin, '{"topup_enabled":true}');

  assert (select out_outcome from public.create_topup_request(a, 'XXX', 50000, 'idem-t4-nobank01')) = 'BANK_UNAVAILABLE';
  assert (select out_outcome from public.create_topup_request(a, 'BRI', 9999, 'idem-t4-low00001')) = 'AMOUNT_OUT_OF_RANGE', 'below minimum';
  assert (select out_outcome from public.create_topup_request(a, 'BRI', 2000001, 'idem-t4-high0001')) = 'AMOUNT_OUT_OF_RANGE', 'above maximum';
  assert (select out_outcome from public.create_topup_request(gen_random_uuid(), 'BRI', 50000, 'idem-t4-nouser01')) = 'USER_NOT_FOUND';

  select * into r from public.create_topup_request(a, 'bri', 50000, 'idem-t4-create001');
  assert r.out_outcome = 'CREATED' and r.out_status = 'PENDING' and r.out_bank_code = 'BRI', 'created (bank code case-insensitive)';
  assert r.out_unique_code between 1 and 999 and r.out_total_amount = 50000 + r.out_unique_code, 'total = base + code in range';
  assert r.out_expires_at between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute', '24h validity';
  select * into r2 from public.create_topup_request(a, 'BRI', 50000, 'idem-t4-create001');
  assert r2.out_outcome = 'EXISTING' and r2.out_request_id = r.out_request_id and r2.out_total_amount = r.out_total_amount, 'same key, same request';
  assert (select saldo from public.profiles where id = a) = saldo_before, 'creating a request never touches saldo';
  insert into fx4 values ('req_a1', r.out_request_id::text), ('total_a1', r.out_total_amount::text);

  -- many users, same base: every pending total is distinct
  for i in 1..3 loop
    select * into r from public.create_topup_request(b, 'BRI', 50000, 'idem-t4-many-' || i);
    assert r.out_outcome = 'CREATED'; codes := codes || r.out_total_amount::int;
  end loop;
  assert (select count(distinct x) from unnest(codes) x) = 3, 'distinct totals';
  assert (select out_outcome from public.create_topup_request(b, 'BRI', 50000, 'idem-t4-many-4')) = 'TOO_MANY_PENDING', 'pending cap per user';
  assert (select out_outcome from public.create_topup_request(b, 'BRI', 50000, 'idem-t4-many-1')) = 'EXISTING', 'cap does not break idempotent repeats';

  perform public.admin_set_user_flags(admin, (select v::uuid from fx4 where k = 'plain'), '{"is_active":false}');
  assert (select out_outcome from public.create_topup_request((select v::uuid from fx4 where k = 'plain'), 'BRI', 50000, 'idem-t4-inactive1')) = 'USER_INACTIVE';
  perform public.admin_set_user_flags(admin, (select v::uuid from fx4 where k = 'plain'), '{"is_active":true}');
end $$;

-- T4: nominal uniqueness, lazy expiry, cancel ------------------------------------------------------------------
do $$
declare
  admin uuid := (select v::uuid from fx4 where k = 'admin');
  a uuid := (select v::uuid from fx4 where k = 'a'); c uuid := (select v::uuid from fx4 where k = 'c');
  plain uuid := (select v::uuid from fx4 where k = 'plain');
  r record; first_id uuid; n int;
begin
  perform public.admin_update_settings(admin, '{"topup_code_min":7,"topup_code_max":7}');   -- a single possible code
  select * into r from public.create_topup_request(c, 'BRI', 100000, 'idem-t4-single001');
  assert r.out_outcome = 'CREATED' and r.out_total_amount = 100007; first_id := r.out_request_id;
  assert (select out_outcome from public.create_topup_request(plain, 'BRI', 100000, 'idem-t4-single002')) = 'NO_CODE_AVAILABLE', 'nominal is taken: refuse, never duplicate';

  begin insert into public.topup_requests (user_id, bank_id, bank_code, idempotency_key, base_amount, unique_code, expires_at)
        select plain, bank_id, bank_code, 'idem-t4-direct001', 100000, 7, now() + interval '1 hour' from public.topup_requests where id = first_id;
        assert false, 'unique index let a duplicate pending nominal in';
  exception when unique_violation then null; end;

  -- cancel frees the nominal
  assert (select out_outcome from public.cancel_topup_request(plain, first_id)) = 'NOT_FOUND', 'cannot cancel someone else''s request';
  assert (select out_outcome from public.cancel_topup_request(c, first_id)) = 'CANCELLED';
  assert (select out_outcome from public.cancel_topup_request(c, first_id)) = 'NOT_PENDING';
  select * into r from public.create_topup_request(plain, 'BRI', 100000, 'idem-t4-single003');
  assert r.out_outcome = 'CREATED' and r.out_total_amount = 100007, 'freed nominal reusable'; first_id := r.out_request_id;

  -- an expired-but-unswept request does not block its nominal (lazy expiry)
  alter table public.topup_requests disable trigger topup_requests_guard_trg;
  update public.topup_requests set expires_at = now() - interval '1 minute' where id = first_id;
  alter table public.topup_requests enable trigger topup_requests_guard_trg;
  select * into r from public.create_topup_request(c, 'BRI', 100000, 'idem-t4-single004');
  assert r.out_outcome = 'CREATED' and r.out_total_amount = 100007, 'stale pending request yields its nominal';
  assert (select status from public.topup_requests where id = first_id) = 'EXPIRED', 'and is marked EXPIRED';
  perform public.cancel_topup_request(c, r.out_request_id);

  -- sweeper
  alter table public.topup_requests disable trigger topup_requests_guard_trg;
  update public.topup_requests set expires_at = now() - interval '1 minute'
   where id = (select v::uuid from fx4 where k = 'req_a1');
  alter table public.topup_requests enable trigger topup_requests_guard_trg;
  n := public.expire_topup_requests();
  assert n >= 1 and (select status from public.topup_requests where id = (select v::uuid from fx4 where k = 'req_a1')) = 'EXPIRED', 'sweeper expires';
  assert public.expire_topup_requests() = 0, 'sweeper is idempotent';

  perform public.admin_update_settings(admin, '{"topup_code_min":1,"topup_code_max":999}');
end $$;

-- T5: incoming transfers ---------------------------------------------------------------------------------------------
do $$
declare
  admin uuid := (select v::uuid from fx4 where k = 'admin');
  a uuid := (select v::uuid from fx4 where k = 'a');
  r record; q record; req record; before_bal bigint; tid uuid;
begin
  -- happy path
  select * into req from public.create_topup_request(a, 'BRI', 200000, 'idem-t5-happy0001');
  before_bal := (select saldo from public.profiles where id = a);
  select * into r from public.record_incoming_transfer('BRI', req.out_total_amount, 'MUT-0001', now(), '{"x":1}');
  assert r.out_outcome = 'CREDITED' and r.out_request_id = req.out_request_id and r.out_user_id = a, 'credited';
  assert (select saldo from public.profiles where id = a) = before_bal + req.out_total_amount, 'saldo = + FULL transferred amount (incl. unique code)';
  assert (select (type, amount, idempotency_key) from public.balance_ledger where idempotency_key = 'req:' || req.out_request_id::text)
         = ('TOPUP'::text, req.out_total_amount, 'req:' || req.out_request_id::text), 'ledger TOPUP row';
  assert (select status from public.topup_requests where id = req.out_request_id) = 'PAID';

  -- replay of the same bank transaction
  select * into r from public.record_incoming_transfer('BRI', req.out_total_amount, 'MUT-0001', now(), '{"x":1}');
  assert r.out_outcome = 'ALREADY_RECORDED' and (select saldo from public.profiles where id = a) = before_bal + req.out_total_amount, 'replay credits nothing';

  -- a DIFFERENT bank transaction with the same amount after the request is paid -> queue, never a second credit
  select * into r from public.record_incoming_transfer('BRI', req.out_total_amount, 'MUT-0002', now(), null);
  assert r.out_outcome = 'QUEUED' and (select reason from public.topup_transfers where id = r.out_transfer_id) = 'MATCHES_PAID_REQUEST';
  assert (select saldo from public.profiles where id = a) = before_bal + req.out_total_amount, 'no second credit';

  -- unknown amount
  select * into r from public.record_incoming_transfer('BRI', 12345, 'MUT-0003', now(), null);
  assert r.out_outcome = 'QUEUED' and (select reason from public.topup_transfers where id = r.out_transfer_id) = 'NO_MATCH';

  -- wrong bank never matches
  select * into req from public.create_topup_request(a, 'BRI', 300000, 'idem-t5-bank00001');
  select * into r from public.record_incoming_transfer('BNI', req.out_total_amount, 'MUT-0004', now(), null);
  assert r.out_outcome = 'QUEUED', 'same amount on another bank does not match';
  assert (select status from public.topup_requests where id = req.out_request_id) = 'PENDING';

  -- money that ARRIVED after expiry is queued and the request expires
  alter table public.topup_requests disable trigger topup_requests_guard_trg;
  update public.topup_requests set expires_at = now() - interval '1 minute' where id = req.out_request_id;
  alter table public.topup_requests enable trigger topup_requests_guard_trg;
  before_bal := (select saldo from public.profiles where id = a);
  select * into r from public.record_incoming_transfer('BRI', req.out_total_amount, 'MUT-0005', now(), null);
  assert r.out_outcome = 'QUEUED' and (select reason from public.topup_transfers where id = r.out_transfer_id) = 'EXPIRED';
  assert (select status from public.topup_requests where id = req.out_request_id) = 'EXPIRED' and (select saldo from public.profiles where id = a) = before_bal, 'late money is never auto-credited';
  tid := r.out_transfer_id;

  -- ...but money that arrived BEFORE expiry is credited even if we only hear about it later
  select * into req from public.create_topup_request(a, 'BRI', 250000, 'idem-t5-delayed001');
  alter table public.topup_requests disable trigger topup_requests_guard_trg;
  update public.topup_requests set expires_at = now() - interval '1 minute' where id = req.out_request_id;
  alter table public.topup_requests enable trigger topup_requests_guard_trg;
  select * into r from public.record_incoming_transfer('BRI', req.out_total_amount, 'MUT-0006', now() - interval '5 minutes', null);
  assert r.out_outcome = 'CREDITED', 'judged by when the money arrived';

  -- inactive user -> queued, request stays pending
  select * into req from public.create_topup_request(a, 'BRI', 260000, 'idem-t5-inactive01');
  perform public.admin_set_user_flags(admin, a, '{"is_active":false}');
  select * into r from public.record_incoming_transfer('BRI', req.out_total_amount, 'MUT-0007', now(), null);
  assert r.out_outcome = 'QUEUED' and (select reason from public.topup_transfers where id = r.out_transfer_id) = 'USER_INACTIVE';
  assert (select status from public.topup_requests where id = req.out_request_id) = 'PENDING';
  perform public.admin_set_user_flags(admin, a, '{"is_active":true}');

  -- validation
  begin perform public.record_incoming_transfer('BRI', 0, 'MUT-X1'); assert false, 'zero amount';
  exception when invalid_parameter_value then null; end;
  begin perform public.record_incoming_transfer('BRI', 1000, '  '); assert false, 'blank ref';
  exception when invalid_parameter_value then null; end;
  begin perform public.record_incoming_transfer('bri!', 1000, 'MUT-X2'); assert false, 'bad bank code';
  exception when invalid_parameter_value then null; end;
  insert into fx4 values ('late_transfer', tid::text), ('inactive_req', req.out_request_id::text), ('inactive_total', req.out_total_amount::text);
end $$;

-- T6: admin confirm / resolve -----------------------------------------------------------------------------------------
do $$
declare
  admin uuid := (select v::uuid from fx4 where k = 'admin'); a uuid := (select v::uuid from fx4 where k = 'a');
  plain uuid := (select v::uuid from fx4 where k = 'plain'); c uuid := (select v::uuid from fx4 where k = 'c');
  req record; r record; bal bigint; q record; tid uuid := (select v::uuid from fx4 where k = 'late_transfer');
begin
  -- confirm a PENDING request by hand
  select * into req from public.create_topup_request(plain, 'BRI', 70000, 'idem-t6-confirm001');
  bal := (select saldo from public.profiles where id = plain);
  begin perform public.admin_confirm_topup_request(admin, req.out_request_id, 'x'); assert false, 'note required';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_confirm_topup_request(plain, req.out_request_id, 'sudah dicek'); assert false, 'non-admin';
  exception when insufficient_privilege then null; end;
  select * into q from public.admin_confirm_topup_request(admin, req.out_request_id, 'dicek di BRImo');
  assert q.out_outcome = 'APPLIED' and (select saldo from public.profiles where id = plain) = bal + req.out_total_amount, 'confirmed + credited';
  assert (select out_outcome from public.admin_confirm_topup_request(admin, req.out_request_id, 'dicek lagi')) = 'ALREADY_APPLIED', 'idempotent';
  assert (select saldo from public.profiles where id = plain) = bal + req.out_total_amount, 'no double credit';
  assert (select out_outcome from public.admin_confirm_topup_request(admin, gen_random_uuid(), 'dicek lagi')) = 'NOT_FOUND';

  -- confirm an EXPIRED request (late payment verified by a human)
  assert (select status from public.topup_requests where id = (select v::uuid from fx4 where k = 'req_a1')) = 'EXPIRED';
  bal := (select saldo from public.profiles where id = a);
  assert (select out_outcome from public.admin_confirm_topup_request(admin, (select v::uuid from fx4 where k = 'req_a1'), 'transfer telat, terverifikasi')) = 'APPLIED';
  assert (select saldo from public.profiles where id = a) = bal + (select v::bigint from fx4 where k = 'total_a1'), 'late confirmed request credited';

  -- a CANCELLED request cannot be confirmed
  select * into req from public.create_topup_request(c, 'BRI', 80000, 'idem-t6-cancel0001');
  assert req.out_outcome = 'CREATED';
  perform public.cancel_topup_request(c, req.out_request_id);
  assert (select out_outcome from public.admin_confirm_topup_request(admin, req.out_request_id, 'harusnya ditolak')) = 'CANCELLED';

  -- resolve a queued transfer: credit a chosen user exactly once
  assert (select status from public.topup_transfers where id = tid) = 'QUEUED';
  bal := (select saldo from public.profiles where id = a);
  begin perform public.admin_resolve_transfer(admin, tid, 'CREDIT', null, 'user dipilih'); assert false, 'user required';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_resolve_transfer(admin, tid, 'DELETE', a, 'catatan'); assert false, 'bad action';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_resolve_transfer(plain, tid, 'CREDIT', a, 'catatan'); assert false, 'non-admin';
  exception when insufficient_privilege then null; end;
  select * into r from public.admin_resolve_transfer(admin, tid, 'CREDIT', a, 'pemilik terverifikasi');
  assert r.out_outcome = 'CREDITED' and (select saldo from public.profiles where id = a) = bal + (select amount from public.topup_transfers where id = tid);
  assert (select status from public.topup_transfers where id = tid) = 'RESOLVED';
  assert (select out_outcome from public.admin_resolve_transfer(admin, tid, 'CREDIT', a, 'sekali lagi')) = 'NOT_QUEUED', 'cannot credit twice';
  assert (select saldo from public.profiles where id = a) = bal + (select amount from public.topup_transfers where id = tid), 'still credited once';

  -- ignore a queued transfer
  select t.id into tid from public.topup_transfers t where t.bank_ref = 'MUT-0003';
  assert (select out_outcome from public.admin_resolve_transfer(admin, tid, 'IGNORE', null, 'salah kirim, bukan user')) = 'IGNORED';
  assert (select status from public.topup_transfers where id = tid) = 'IGNORED';
  assert (select count(*) from public.admin_audit_log where action in ('confirm_topup_request', 'resolve_transfer')) >= 4, 'audited';

  -- bank account changes are refused while users are mid-payment
  select * into req from public.create_topup_request(c, 'BRI', 90000, 'idem-t6-bankchg001');
  assert req.out_outcome = 'CREATED';
  assert (select out_outcome from public.admin_upsert_topup_bank(admin, 'BRI', 'Bank BRI', '9999999999', 'Pemilik Test', true)) = 'HAS_PENDING_REQUESTS';
  assert (select out_outcome from public.admin_upsert_topup_bank(admin, 'BRI', 'Bank BRI', '1234567890', 'Pemilik Test', true)) = 'UPDATED', 'other edits are fine';
  perform public.cancel_topup_request(c, req.out_request_id);
end $$;

-- T7: nothing bypasses the RPCs ----------------------------------------------------------------------------------------
do $$
declare req uuid := (select v::uuid from fx4 where k = 'inactive_req'); tr uuid := (select id from public.topup_transfers limit 1);
begin
  begin update public.topup_requests set status = 'PAID', paid_at = now() where id = req; assert false, 'status changed without RPC';
  exception when insufficient_privilege then null; end;
  begin update public.topup_requests set base_amount = 1 where id = req; assert false, 'amount mutable';
  exception when insufficient_privilege then null; end;
  begin delete from public.topup_requests where id = req; assert false, 'deletable';
  exception when insufficient_privilege then null; end;
  begin update public.topup_transfers set amount = 1 where id = tr; assert false, 'transfer amount mutable';
  exception when insufficient_privilege then null; end;
  begin delete from public.topup_transfers; assert false, 'transfers deletable';
  exception when insufficient_privilege then null; end;
  -- a finalised transfer cannot change again
  begin update public.topup_transfers set reason = 'x' where status = 'CREDITED'; assert false, 'final transfer mutable';
  exception when insufficient_privilege then null; end;
  begin update public.topup_requests set status = 'PENDING' where status = 'PAID'; assert false, 'PAID reopened';
  exception when insufficient_privilege then null; end;
end $$;

-- T8: API-role access -----------------------------------------------------------------------------------------------------
do $$
declare a uuid := (select v::uuid from fx4 where k = 'a'); n int; admin uuid := (select v::uuid from fx4 where k = 'admin');
  own int := (select count(*) from public.topup_requests where user_id = (select v::uuid from fx4 where k = 'a'));
  total int := (select count(*) from public.topup_requests);
begin
  assert own >= 1 and total > own, 'fixture: several users have requests';
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  select count(*) into n from public.topup_requests;
  assert n = own, 'sees only own requests (not the ' || total || ' total)';
  perform total_amount, status, expires_at from public.topup_requests;
  begin perform bank_ref from public.topup_requests; assert false, 'bank_ref readable';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.topup_banks; assert false, 'banks readable directly';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.topup_transfers; assert false, 'transfers readable';
  exception when insufficient_privilege then null; end;
  begin insert into public.topup_requests (user_id, bank_id, bank_code, idempotency_key, base_amount, unique_code, expires_at)
        select a, id, code, 'idem-hack-00001', 10000, 1, now() from public.topup_banks; assert false, 'user inserted a request';
  exception when insufficient_privilege then null; end;
  begin update public.topup_requests set status = 'PAID'; assert false, 'user updated a request';
  exception when insufficient_privilege then null; end;
  begin perform public.create_topup_request(a, 'BRI', 50000, 'idem-hack-00002'); assert false, 'create callable by user';
  exception when insufficient_privilege then null; end;
  begin perform public.record_incoming_transfer('BRI', 1000, 'HACK-1'); assert false, 'transfer RPC callable by user';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_confirm_topup_request(admin, gen_random_uuid(), 'hack'); assert false, 'confirm callable by user';
  exception when insufficient_privilege then null; end;
  begin perform public.expire_topup_requests(); assert false, 'sweeper callable by user';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  begin perform 1 from public.topup_requests; assert false, 'anon reads requests';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- T9: admin reads + dashboard counters -------------------------------------------------------------------------------------
do $$
declare st jsonb; n int;
begin
  set local role service_role;
  select count(*) into n from public.admin_list_topups(p_status => 'PAID'); assert n >= 3, 'paid requests listed';
  select count(*) into n from public.admin_list_topups(p_search => 'tu-a@t'); assert n >= 1, 'search by email';
  select count(*) into n from public.admin_list_topups(p_search => '%'); assert n = 0, '% is literal';
  select count(*) into n from public.admin_list_transfers(p_status => 'QUEUED'); assert n >= 1, 'queue listed';
  select count(*) into n from public.admin_list_transfers(p_status => 'IGNORED'); assert n >= 1;
  st := public.admin_dashboard_stats(now() - interval '1 day');
  assert st ? 'topup_pending' and st ? 'topup_queued' and (st ->> 'topup_queued')::int >= 1, 'dashboard counters';
  assert st ? 'users_total' and st ? 'since_profit', 'old counters intact';
  reset role;
end $$;

do $$ begin
  assert (select count(*) from public.find_balance_mismatches()) = 0, 'saldo matches ledger after all top-up flows';
end $$;

select 'ALL TOP-UP SQL TESTS PASSED' as result;
