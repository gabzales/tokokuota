-- 0008: one-time "setup" for the FIRST admin from the web (/setup), so nobody has to touch the SQL editor.
-- Everything is service_role only. The page itself is additionally protected by SETUP_SECRET (env) and disables
-- itself as soon as an admin exists. Both functions take the same advisory lock so two parallel setups cannot
-- produce two admins: the loser is told "already set up" and the app deletes the account it just created.

create or replace function public.setup_needed()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (select 1 from public.profiles where role = 'admin');
$$;

-- Returns a fresh single-use invite (valid 10 minutes) for the first admin's signup, or NULL if an admin already exists.
create or replace function public.bootstrap_admin_invite()
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text;
begin
  perform pg_advisory_xact_lock(hashtext('toko-kuota:bootstrap-admin'));
  if exists (select 1 from public.profiles where role = 'admin') then return null; end if;
  insert into public.invite_codes (note, expires_at)
  values ('setup admin pertama', now() + interval '10 minutes')
  returning code into v_code;
  return v_code;
end $$;

-- Promotes the given user to admin ONLY IF no other admin exists. Returns false when someone else got there first.
create or replace function public.bootstrap_promote_admin(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('toko-kuota:bootstrap-admin'));
  if exists (select 1 from public.profiles where role = 'admin' and id <> p_user_id) then return false; end if;
  update public.profiles set role = 'admin' where id = p_user_id;
  if not found then return false; end if;
  perform public._audit(p_user_id, 'bootstrap_first_admin', 'profile', p_user_id::text, '{}'::jsonb);
  return true;
end $$;

revoke all on function public.setup_needed(), public.bootstrap_admin_invite(), public.bootstrap_promote_admin(uuid)
  from public, anon, authenticated;
grant execute on function public.setup_needed(), public.bootstrap_admin_invite(), public.bootstrap_promote_admin(uuid)
  to service_role;
