-- Tests for 0005_hardening.sql (run after 10..13 on the same database).
\set ON_ERROR_STOP on

-- T1: nothing in public is executable by API roles ---------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prokind = 'f'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  assert n = 0, n || ' public function(s) are still executable by anon/authenticated';

  -- the signup trigger still works without PUBLIC execute
  insert into auth.users (email) values ('hard-signup@t.test');
  assert exists (select 1 from public.profiles where email = 'hard-signup@t.test'), 'handle_new_user stopped working';
end $$;

-- T2: every foreign key has a supporting index ---------------------------------------------------------
do $$
declare missing text;
begin
  select string_agg(conrelid::regclass || '.' || a.attname, ', ') into missing
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace
     and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]);
  assert missing is null, 'foreign keys without an index: ' || coalesce(missing, '');
end $$;

-- T3: trigram indexes exist and the planner can use them ---------------------------------------------------
do $$
declare n int; r text; used boolean;
begin
  select count(*) into n from pg_indexes where schemaname = 'public' and indexdef ilike '%gin_trgm_ops%';
  assert n >= 8, 'expected 8 trigram indexes, found ' || n;

  set local enable_seqscan = off;   -- tables are tiny; force the planner to show whether the index COULD be used
  used := false;
  for r in execute 'explain (costs off) select 1 from public.profiles where email ilike ''%abc%''' loop
    if r ilike '%profiles_email_trgm%' then used := true; end if;
  end loop;
  assert used, 'ILIKE on profiles.email cannot use the trigram index';

  used := false;
  for r in execute 'explain (costs off) select 1 from public.transactions where destination ilike ''%0812%''' loop
    if r ilike '%transactions_dest_trgm%' then used := true; end if;
  end loop;
  assert used, 'ILIKE on transactions.destination cannot use the trigram index';
end $$;

-- T4: rate limiter -------------------------------------------------------------------------------------------
do $$
declare r record; i int;
begin
  for i in 1..3 loop
    select * into r from public.rate_limit_hit('rl-test-a', 3, 3600);
    assert r.out_allowed and r.out_hits = i, 'hit ' || i || ' should be allowed';
  end loop;
  select * into r from public.rate_limit_hit('rl-test-a', 3, 3600);
  assert not r.out_allowed and r.out_hits = 4, 'the 4th hit must be refused';
  assert r.out_retry_after between 1 and 3600, 'retry_after is within the window';
  select * into r from public.rate_limit_hit('rl-test-a', 3, 3600);
  assert not r.out_allowed, 'stays refused for the rest of the window';
  select * into r from public.rate_limit_hit('rl-test-b', 3, 3600);
  assert r.out_allowed and r.out_hits = 1, 'keys are independent';

  begin perform public.rate_limit_hit('', 3, 60); assert false, 'empty key';
  exception when invalid_parameter_value then null; end;
  begin perform public.rate_limit_hit('k', 0, 60); assert false, 'zero limit';
  exception when invalid_parameter_value then null; end;
  begin perform public.rate_limit_hit('k', 3, 0); assert false, 'zero window';
  exception when invalid_parameter_value then null; end;
  begin perform public.rate_limit_hit('k', 3, 86401); assert false, 'window too long';
  exception when invalid_parameter_value then null; end;

  insert into public.rate_limits (key, window_start, hits) values ('rl-old', now() - interval '3 days', 5);
  assert public.rate_limit_cleanup() >= 1, 'cleanup removes old windows';
  assert not exists (select 1 from public.rate_limits where key = 'rl-old');
  assert exists (select 1 from public.rate_limits where key = 'rl-test-a'), 'cleanup keeps current windows';
end $$;

-- a new window starts fresh (now() is fixed inside one transaction, so each step is its own transaction)
do $$ begin
  perform public.rate_limit_hit('rl-test-w', 1, 2);
  assert not (select out_allowed from public.rate_limit_hit('rl-test-w', 1, 2)), 'second hit in the same window is refused';
end $$;
select pg_sleep(2.2);
do $$ begin
  assert (select out_allowed from public.rate_limit_hit('rl-test-w', 1, 2)), 'allowed again in the next window';
end $$;

do $$
begin
  set local role authenticated;
  begin perform public.rate_limit_hit('x', 1, 60); assert false, 'callable by users';
  exception when insufficient_privilege then null; end;
  begin perform public.rate_limit_cleanup(); assert false, 'cleanup callable by users';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.rate_limits; assert false, 'table readable by users';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role service_role;
  perform public.rate_limit_hit('rl-svc', 5, 60);
  reset role;
end $$;

select 'ALL HARDENING SQL TESTS PASSED' as result;
