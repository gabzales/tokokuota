-- 0007: registration only with an invite code issued by an admin.
-- Why a database trigger and not just a check in the app: the Supabase anon key is public, so anybody
-- can call the Auth API (signUp) directly and skip our register page. The BEFORE INSERT trigger on
-- auth.users is the one door every signup passes through, so the rule cannot be bypassed.
--
-- Codes: single-use, expire (default 7 days), can be revoked. A code is consumed in the same transaction
-- that creates the user: if the signup fails for any reason (e.g. e-mail already taken) the code is NOT burned.
-- FIRST ADMIN (bootstrap): nobody can sign up without a code, so create the first one in the SQL editor:
--   insert into public.invite_codes (note, expires_at) values ('admin pertama', now() + interval '1 day') returning code;

create or replace function public._gen_invite_code()
returns text language sql volatile as $$
  select 'TK-' || upper(substr(h, 1, 4)) || '-' || upper(substr(h, 5, 4)) || '-' || upper(substr(h, 9, 4))
    from (select replace(gen_random_uuid()::text, '-', '') as h) s;
$$;

create table public.invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique default public._gen_invite_code(),
  note        text,                                   -- who it is for (admin's own label)
  expires_at  timestamptz not null default now() + interval '7 days',
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  used_at     timestamptz,
  used_by     uuid,                                   -- no FK: set while the user row is being created (no profile yet)
  used_email  text,
  constraint invite_codes_code_format check (code ~ '^TK-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'),
  constraint invite_codes_note_len    check (note is null or char_length(note) <= 100),
  constraint invite_codes_used_pair   check ((used_at is null) = (used_by is null))
);
create index invite_codes_created_idx    on public.invite_codes (created_at desc);
create index invite_codes_created_by_idx on public.invite_codes (created_by);   -- every FK is indexed (see 14_hardening)

alter table public.invite_codes enable row level security;     -- no policies: only service_role / SECURITY DEFINER code
revoke all on public.invite_codes from public, anon, authenticated;
grant select on public.invite_codes to service_role;

-- The gate -----------------------------------------------------------------------------------------------------------
create or replace function public.enforce_invite_on_signup()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code text := upper(btrim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')));
  v_id   uuid;
begin
  update public.invite_codes
     set used_at = now(), used_by = new.id, used_email = new.email
   where code = v_code and used_at is null and revoked_at is null and expires_at > now()
  returning id into v_id;                                -- one atomic statement: two signups can never share a code
  if v_id is null then
    raise exception 'invite code missing, invalid, used or expired' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger enforce_invite_on_signup
  before insert on auth.users
  for each row execute function public.enforce_invite_on_signup();

-- Read-only check used by the register page to give a clear message (the trigger above is what enforces) ---------------
create or replace function public.invite_code_valid(p_code text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.invite_codes c
     where c.code = upper(btrim(coalesce(p_code, ''))) and c.used_at is null and c.revoked_at is null and c.expires_at > now());
$$;

-- Admin ---------------------------------------------------------------------------------------------------------------
create or replace function public.admin_create_invite_code(p_admin_id uuid, p_note text, p_valid_days integer default 7)
returns table (out_id uuid, out_code text, out_expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row  public.invite_codes%rowtype;
begin
  perform public._require_admin(p_admin_id);
  if p_valid_days is null or p_valid_days < 1 or p_valid_days > 90 then
    raise exception 'valid days must be between 1 and 90' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 100 then
    raise exception 'note too long' using errcode = '22023';
  end if;
  insert into public.invite_codes (note, expires_at, created_by)
  values (v_note, now() + make_interval(days => p_valid_days), p_admin_id)
  returning * into v_row;
  perform public._audit(p_admin_id, 'create_invite_code', 'invite_code', v_row.id::text,
    jsonb_build_object('note', v_note, 'expires_at', v_row.expires_at));
  return query select v_row.id, v_row.code, v_row.expires_at;
end $$;

create or replace function public.admin_revoke_invite_code(p_admin_id uuid, p_id uuid)
returns table (out_outcome text)   -- REVOKED | NOT_FOUND | ALREADY_USED | ALREADY_REVOKED
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_row public.invite_codes%rowtype;
begin
  perform public._require_admin(p_admin_id);
  select * into v_row from public.invite_codes c where c.id = p_id for update;
  if not found then return query select 'NOT_FOUND'; return; end if;
  if v_row.used_at is not null then return query select 'ALREADY_USED'; return; end if;
  if v_row.revoked_at is not null then return query select 'ALREADY_REVOKED'; return; end if;
  update public.invite_codes set revoked_at = now() where id = v_row.id;
  perform public._audit(p_admin_id, 'revoke_invite_code', 'invite_code', v_row.id::text, jsonb_build_object('note', v_row.note));
  return query select 'REVOKED';
end $$;

revoke all on function
  public._gen_invite_code(), public.enforce_invite_on_signup(), public.invite_code_valid(text),
  public.admin_create_invite_code(uuid, text, integer), public.admin_revoke_invite_code(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.invite_code_valid(text), public.admin_create_invite_code(uuid, text, integer), public.admin_revoke_invite_code(uuid, uuid)
  to service_role;
