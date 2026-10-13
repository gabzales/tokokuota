-- Tests for 0009_diagnostics.sql (after 16, which leaves an admin and a plain user behind).
\set ON_ERROR_STOP on
do $$
declare a uuid := (select id from public.profiles where email = 'inv-admin@t.test');
        u uuid := (select id from public.profiles where email = 'inv-user@t.test'); n int;
begin
  assert a is not null and u is not null, 'fixtures from suite 16 are missing';
  perform public.admin_log_diagnostic(a, 'khfy_key', 'fail', 'HTTP_401', 401, 123, 'ditolak', 'GET https://x/api_v2/history?api_key=***');
  assert exists (select 1 from public.diagnostic_logs where admin_id = a and check_id = 'khfy_key' and code = 'HTTP_401' and http_status = 401 and latency_ms = 123), 'row written';

  -- limits are enforced by the database, not trusted from the app
  perform public.admin_log_diagnostic(a, repeat('c', 99), 'pass', repeat('k', 99), null, null, repeat('s', 999), repeat('d', 9999));
  assert (select max(length(check_id)) from public.diagnostic_logs) = 40 and (select max(length(code)) from public.diagnostic_logs) = 60
     and (select max(length(summary)) from public.diagnostic_logs) = 300 and (select max(length(detail)) from public.diagnostic_logs) = 4000, 'truncated';
  begin perform public.admin_log_diagnostic(a, 'x', 'maybe', 'c', null, null, 's', null); assert false, 'bad status';
  exception when check_violation then null; end;
  begin perform public.admin_log_diagnostic(u, 'x', 'pass', 'c', null, null, 's', null); assert false, 'non-admin logged';
  exception when insufficient_privilege then null; end;

  -- bounded: newest 300 rows survive
  for i in 1..320 loop perform public.admin_log_diagnostic(a, 'env', 'pass', 'OK', null, i, 'n' || i, null); end loop;
  select count(*) into n from public.diagnostic_logs;
  assert n = 300, 'kept exactly 300, got ' || n;
  assert exists (select 1 from public.diagnostic_logs where summary = 'n320') and not exists (select 1 from public.diagnostic_logs where summary = 'n1'), 'oldest dropped, newest kept';
end $$;

set role authenticated;
do $$
begin
  begin perform 1 from public.diagnostic_logs; assert false, 'authenticated reads logs'; exception when insufficient_privilege then null; end;
  begin perform public.admin_log_diagnostic(gen_random_uuid(), 'x', 'pass', 'c', null, null, 's', null); assert false, 'authenticated writes logs'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$
begin
  begin perform 1 from public.diagnostic_logs; assert false, 'anon reads logs'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'diagnostics tests OK';
