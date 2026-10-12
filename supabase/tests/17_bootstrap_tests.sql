-- Tests for 0008_bootstrap_admin.sql. Runs in ONE transaction that is rolled back (it demotes every admin to simulate a fresh install).
\set ON_ERROR_STOP on
begin;
do $$
declare c text; u1 uuid;
begin
  update public.profiles set role = 'user' where role = 'admin';
  assert public.setup_needed(), 'fresh install needs setup';

  c := public.bootstrap_admin_invite();
  assert c ~ '^TK-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$', 'invite issued';
  assert (select expires_at from public.invite_codes where code = c) <= now() + interval '10 minutes 1 second', 'short-lived';
  insert into auth.users (email, raw_user_meta_data) values ('first-admin@t.test', jsonb_build_object('invite_code', c)) returning id into u1;
  assert public.bootstrap_promote_admin(u1), 'first promotion works';
  assert (select role from public.profiles where id = u1) = 'admin';
  assert not public.setup_needed(), 'setup closes itself once an admin exists';
  assert exists (select 1 from public.admin_audit_log where action = 'bootstrap_first_admin' and admin_id = u1), 'audited';

  -- a second attempt (an attacker who learned the secret later) gets nothing
  assert public.bootstrap_admin_invite() is null, 'no invite once an admin exists';
  begin
    insert into auth.users (email, raw_user_meta_data) values ('late@t.test', jsonb_build_object('invite_code', public._gen_invite_code()));
    assert false, 'a made-up code must not create a user';
  exception when raise_exception then null; end;
end $$;

do $$
declare u2 uuid; u1 uuid := (select id from public.profiles where email = 'first-admin@t.test'); k text;
begin
  -- race loser: a user created with a valid code that tries to promote after the first admin exists
  insert into public.invite_codes (note) values ('x') returning code into k;
  insert into auth.users (email, raw_user_meta_data) values ('loser@t.test', jsonb_build_object('invite_code', k)) returning id into u2;
  assert not public.bootstrap_promote_admin(u2), 'second admin refused';
  assert (select role from public.profiles where id = u2) = 'user', 'loser stays a plain user';
  assert not public.bootstrap_promote_admin(gen_random_uuid()), 'unknown user';
  assert public.bootstrap_promote_admin(u1), 'idempotent for the existing first admin';
end $$;

set local role authenticated;
do $$
begin
  begin perform public.setup_needed(); assert false, 'authenticated can call setup_needed'; exception when insufficient_privilege then null; end;
  begin perform public.bootstrap_admin_invite(); assert false, 'authenticated can mint setup invites'; exception when insufficient_privilege then null; end;
  begin perform public.bootstrap_promote_admin(gen_random_uuid()); assert false, 'authenticated can promote'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin perform public.bootstrap_promote_admin(gen_random_uuid()); assert false, 'anon can promote'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'bootstrap tests OK';
