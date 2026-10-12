-- Tests for 0007_invite_codes.sql (run after 10..15 on the same database).
\set ON_ERROR_STOP on
-- run.sh disables the gate for the earlier suites (they insert users directly); here it is ON again.
alter table auth.users enable trigger enforce_invite_on_signup;

create temp table fx7 (k text primary key, v text);
grant all on fx7 to public;

do $$
declare a uuid; u uuid;
begin
  alter table auth.users disable trigger enforce_invite_on_signup;
  insert into auth.users (email) values ('inv-admin@t.test') returning id into a;
  insert into auth.users (email) values ('inv-user@t.test') returning id into u;
  alter table auth.users enable trigger enforce_invite_on_signup;
  update public.profiles set role = 'admin' where id = a;
  insert into fx7 values ('admin', a::text), ('user', u::text);
end $$;

-- T1: the gate -----------------------------------------------------------------------------------------------
do $$
declare a uuid := (select v::uuid from fx7 where k = 'admin'); c record; n int; uid uuid;
begin
  -- no code / junk / wrong type: refused, and no user row is left behind
  begin insert into auth.users (email) values ('nocode@t.test'); assert false, 'signup without a code';
  exception when raise_exception then null; end;
  begin insert into auth.users (email, raw_user_meta_data) values ('junk@t.test', '{"invite_code":"TK-0000-0000-0000"}'); assert false, 'unknown code';
  exception when raise_exception then null; end;
  begin insert into auth.users (email, raw_user_meta_data) values ('obj@t.test', '{"invite_code":{"a":1}}'); assert false, 'non-string code';
  exception when raise_exception then null; end;
  begin insert into auth.users (email, raw_user_meta_data) values ('empty@t.test', '{"invite_code":""}'); assert false, 'empty code';
  exception when raise_exception then null; end;
  assert (select count(*) from auth.users where email in ('nocode@t.test','junk@t.test','obj@t.test','empty@t.test')) = 0, 'refused signups leave no user';

  -- a valid code works exactly once (case/space-insensitive), then is dead
  select * into c from public.admin_create_invite_code(a, 'untuk Budi', 7);
  assert c.out_code ~ '^TK-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$', 'code format';
  assert public.invite_code_valid(c.out_code) and public.invite_code_valid('  ' || lower(c.out_code) || ' '), 'valid before use';
  insert into auth.users (email, raw_user_meta_data) values ('budi@t.test', jsonb_build_object('invite_code', ' ' || lower(c.out_code))) returning id into uid;
  assert exists (select 1 from public.profiles where id = uid and role = 'user' and saldo = 0), 'profile created as plain user';
  assert (select used_by from public.invite_codes where id = c.out_id) = uid and (select used_email from public.invite_codes where id = c.out_id) = 'budi@t.test', 'usage recorded';
  assert not public.invite_code_valid(c.out_code), 'dead after use';
  begin insert into auth.users (email, raw_user_meta_data) values ('budi2@t.test', jsonb_build_object('invite_code', c.out_code)); assert false, 'code reused';
  exception when raise_exception then null; end;

  -- a signup that fails later does NOT burn the code (same transaction rolls back)
  select * into c from public.admin_create_invite_code(a, 'retry', 7);
  begin
    insert into auth.users (id, email, raw_user_meta_data) values (uid, 'dup-id@t.test', jsonb_build_object('invite_code', c.out_code));
    assert false, 'duplicate id should fail';
  exception when unique_violation then null; end;
  assert public.invite_code_valid(c.out_code), 'code survives a failed signup';

  -- role/saldo cannot be smuggled in through metadata
  insert into auth.users (email, raw_user_meta_data) values ('sneaky@t.test', jsonb_build_object('invite_code', c.out_code, 'role', 'admin', 'saldo', 999999)) returning id into uid;
  assert (select role from public.profiles where id = uid) = 'user' and (select saldo from public.profiles where id = uid) = 0, 'metadata cannot grant role/saldo';
end $$;

-- T2: expiry, revoke, input limits, admin-only, audit -------------------------------------------------------------
do $$
declare a uuid := (select v::uuid from fx7 where k = 'admin'); u uuid := (select v::uuid from fx7 where k = 'user'); c record; r text;
begin
  select * into c from public.admin_create_invite_code(a, null, 1);
  update public.invite_codes set expires_at = now() - interval '1 second' where id = c.out_id;
  assert not public.invite_code_valid(c.out_code), 'expired code invalid';
  begin insert into auth.users (email, raw_user_meta_data) values ('late@t.test', jsonb_build_object('invite_code', c.out_code)); assert false, 'expired code accepted';
  exception when raise_exception then null; end;

  select * into c from public.admin_create_invite_code(a, 'batal', 3);
  assert (select out_outcome from public.admin_revoke_invite_code(a, c.out_id)) = 'REVOKED';
  assert (select out_outcome from public.admin_revoke_invite_code(a, c.out_id)) = 'ALREADY_REVOKED';
  assert (select out_outcome from public.admin_revoke_invite_code(a, gen_random_uuid())) = 'NOT_FOUND';
  assert not public.invite_code_valid(c.out_code), 'revoked code invalid';
  begin insert into auth.users (email, raw_user_meta_data) values ('rev@t.test', jsonb_build_object('invite_code', c.out_code)); assert false, 'revoked code accepted';
  exception when raise_exception then null; end;
  assert (select out_outcome from public.admin_revoke_invite_code(a, (select id from public.invite_codes where used_email = 'budi@t.test'))) = 'ALREADY_USED', 'used code cannot be revoked';

  begin perform public.admin_create_invite_code(a, 'x', 0); assert false, '0 days'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_create_invite_code(a, 'x', 91); assert false, '91 days'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_create_invite_code(a, repeat('x', 101), 7); assert false, 'long note'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_create_invite_code(u, 'x', 7); assert false, 'non-admin created a code'; exception when insufficient_privilege then null; end;
  begin perform public.admin_revoke_invite_code(u, c.out_id); assert false, 'non-admin revoked'; exception when insufficient_privilege then null; end;

  assert (select count(*) from public.admin_audit_log where action = 'create_invite_code' and admin_id = a) >= 3, 'creates are audited';
  assert (select count(*) from public.admin_audit_log where action = 'revoke_invite_code' and admin_id = a) = 1, 'revoke is audited';
  assert not exists (select 1 from public.admin_audit_log where action like '%invite_code' and details::text ~ 'TK-[0-9A-F]{4}-'), 'the code itself is never written to the audit log';
end $$;

-- T3: the API roles can neither read nor call anything -------------------------------------------------------------
set role authenticated;
do $$
begin
  begin perform 1 from public.invite_codes; assert false, 'authenticated can read invite_codes'; exception when insufficient_privilege then null; end;
  begin perform public.invite_code_valid('TK-0000-0000-0000'); assert false, 'authenticated can probe codes'; exception when insufficient_privilege then null; end;
  begin perform public.admin_create_invite_code(gen_random_uuid(), 'x', 7); assert false, 'authenticated can create codes'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$
begin
  begin perform 1 from public.invite_codes; assert false, 'anon can read invite_codes'; exception when insufficient_privilege then null; end;
  begin perform public.invite_code_valid('TK-0000-0000-0000'); assert false, 'anon can probe codes'; exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'invite tests OK';
