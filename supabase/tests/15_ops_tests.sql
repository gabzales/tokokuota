-- Tests for 0006_ops.sql (run after 10..14 on the same database).
\set ON_ERROR_STOP on
create temp table fx6 (k text primary key, v text);
grant all on fx6 to public;

do $$
declare a1 uuid; a2 uuid; u uuid;
begin
  insert into auth.users (email) values ('cap-admin1@t.test') returning id into a1;
  insert into auth.users (email) values ('cap-admin2@t.test') returning id into a2;
  insert into auth.users (email) values ('cap-user@t.test') returning id into u;
  update public.profiles set role = 'admin' where id in (a1, a2);
  insert into fx6 values ('a1', a1::text), ('a2', a2::text), ('u', u::text);
  assert (select value from public.app_settings where key = 'admin_credit_daily_cap') = '10000000'::jsonb, 'default cap Rp 10 juta';
end $$;

-- T1: the cap --------------------------------------------------------------------------------------------
do $$
declare
  a1 uuid := (select v::uuid from fx6 where k = 'a1'); a2 uuid := (select v::uuid from fx6 where k = 'a2'); u uuid := (select v::uuid from fx6 where k = 'u');
  bal bigint; r record;
begin
  begin perform public.admin_update_settings(a1, '{"admin_credit_daily_cap":0}'); assert false, 'zero cap';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_update_settings(a1, '{"admin_credit_daily_cap":2000000001}'); assert false, 'huge cap';
  exception when invalid_parameter_value then null; end;
  perform public.admin_update_settings(a1, '{"admin_credit_daily_cap":100000}');

  assert (select out_outcome from public.admin_manual_topup(a1, u, 60000, 'cap-key-0000001', 'ok')) = 'APPLIED';
  assert (select out_outcome from public.admin_manual_topup(a1, u, 60000, 'cap-key-0000001', 'replay')) = 'ALREADY_APPLIED', 'a replay is not counted again';
  bal := (select saldo from public.profiles where id = u);
  begin perform public.admin_manual_topup(a1, u, 60000, 'cap-key-0000002', 'over'); assert false, 'cap not enforced';
  exception when program_limit_exceeded then null; end;
  assert (select saldo from public.profiles where id = u) = bal, 'a refused credit moves no money';
  assert (select out_outcome from public.admin_manual_topup(a1, u, 40000, 'cap-key-0000003', 'exactly the cap')) = 'APPLIED', 'up to the cap is allowed';
  begin perform public.admin_manual_topup(a1, u, 1, 'cap-key-0000004', 'one over'); assert false, 'cap not enforced at the limit';
  exception when program_limit_exceeded then null; end;

  assert (select out_outcome from public.admin_manual_topup(a2, u, 60000, 'cap-key-0000005', 'other admin')) = 'APPLIED', 'caps are per admin';

  -- the same cap guards the other manual credit paths
  perform public.admin_upsert_topup_bank(a2, 'CAP', 'Bank Cap', '1234567890', 'Pemilik', true);
  perform public.admin_update_settings(a2, '{"topup_enabled":true}');
  select * into r from public.create_topup_request(u, 'CAP', 50000, 'cap-topup-req-0001');
  assert r.out_outcome = 'CREATED';
  begin perform public.admin_confirm_topup_request(a1, r.out_request_id, 'dicek'); assert false, 'confirm ignores the cap';
  exception when program_limit_exceeded then null; end;
  assert (select status from public.topup_requests where id = r.out_request_id) = 'PENDING', 'refused confirm leaves the request pending';

  perform public.record_incoming_transfer('CAP', 77777, 'CAP-REF-1', now(), null);
  begin perform public.admin_resolve_transfer(a1, (select id from public.topup_transfers where bank_ref = 'CAP-REF-1'), 'CREDIT', u, 'owner'); assert false, 'resolve ignores the cap';
  exception when program_limit_exceeded then null; end;
  assert (select out_outcome from public.admin_resolve_transfer(a1, (select id from public.topup_transfers where bank_ref = 'CAP-REF-1'), 'IGNORE', null, 'bukan user')) = 'IGNORED', 'ignoring is never capped';

  -- an automatic credit (real transfer matched to a request) is not an admin credit
  select * into r from public.create_topup_request(u, 'CAP', 60000, 'cap-topup-req-0002');
  assert (select out_outcome from public.record_incoming_transfer('CAP', r.out_total_amount, 'CAP-REF-2', now(), null)) = 'CREDITED', 'automatic credit unaffected';

  -- raising the cap (audited) unblocks
  perform public.admin_update_settings(a2, '{"admin_credit_daily_cap":1000000}');
  assert (select out_outcome from public.admin_confirm_topup_request(a1, (select id from public.topup_requests where idempotency_key = 'cap-topup-req-0001'), 'dicek lagi')) = 'APPLIED';
  assert (select count(*) from public.admin_audit_log where action = 'update_settings' and details ? 'admin_credit_daily_cap') >= 2, 'cap changes are audited';
  assert (select count(*) from public.find_balance_mismatches()) = 0, 'ledger consistent';
end $$;

-- T2: exports --------------------------------------------------------------------------------------------------
do $$
declare
  a1 uuid := (select v::uuid from fx6 where k = 'a1'); u uuid := (select v::uuid from fx6 where k = 'u');
  n int; n_audit bigint := (select count(*) from public.admin_audit_log where action like 'export_%');
begin
  select count(*) into n from public.admin_export_ledger(a1, now() - interval '1 day', now() + interval '1 day');
  assert n >= 4, 'ledger rows exported';
  select count(*) into n from public.admin_export_ledger(a1, now() - interval '1 day', now() + interval '1 day', 'MANUAL_TOPUP');
  assert n >= 3, 'type filter works';
  assert exists (select 1 from public.admin_export_ledger(a1, now() - interval '1 day', now() + interval '1 day', 'MANUAL_TOPUP') e where e.created_by_email like 'cap-admin%@t.test'), 'creator e-mail is exported';
  select count(*) into n from public.admin_export_transactions(a1, now() - interval '30 days', now() + interval '1 day');
  assert n >= 1, 'transactions exported';
  assert (select count(*) from public.admin_audit_log where action like 'export_%') = n_audit + 4, 'every export is audited';

  assert (select count(*) from public.admin_export_ledger(a1, now() + interval '1 day', now() + interval '2 days')) = 0, 'empty range';
  begin perform public.admin_export_ledger(a1, now(), now() - interval '1 day'); assert false, 'reversed range';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_export_transactions(a1, now() - interval '400 days', now()); assert false, 'range over 366 days';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_export_transactions(u, now() - interval '1 day', now()); assert false, 'non-admin';
  exception when insufficient_privilege then null; end;

  set local role authenticated;
  begin perform public.admin_export_ledger(a1, now() - interval '1 day', now()); assert false, 'callable by users';
  exception when insufficient_privilege then null; end;
  begin perform public._check_admin_credit_cap(a1, 1); assert false, 'helper callable by users';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

do $$ begin
  assert (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prokind = 'f'
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0, 'no public function is open to API roles';
end $$;
select 'ALL OPS SQL TESTS PASSED' as result;
