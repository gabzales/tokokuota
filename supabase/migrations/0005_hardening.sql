-- =====================================================================
-- Toko Kuota — 0005_hardening  (audit follow-ups)
--  1. trigger functions are no longer executable by PUBLIC / anon / authenticated
--     (and Supabase's default grants of new functions to API roles are removed)
--  2. indexes on every foreign key that lacked one
--  3. pg_trgm indexes so the admin ILIKE '%text%' searches stay fast as data grows
--  4. a Postgres-backed rate limiter (atomic, shared by all serverless instances)
-- =====================================================================

-- 1) trigger functions ---------------------------------------------------------------------------
-- Trigger functions cannot be called through the API anyway, but a SECURITY DEFINER one
-- (handle_new_user) with PUBLIC execute is exactly what Supabase's linter flags. Execute
-- privilege is checked when a trigger is CREATED, not when it fires, so revoking is safe.
revoke execute on function
  public.set_updated_at(), public.profiles_guard(), public.handle_new_user(),
  public.admin_audit_log_guard(), public.transactions_guard(), public.balance_ledger_guard(),
  public.topup_requests_guard(), public.topup_transfers_guard()
  from public, anon, authenticated;

-- Supabase's default ACLs also grant EXECUTE on new public functions to anon/authenticated;
-- drop those. (PostgreSQL's own default - EXECUTE for PUBLIC - cannot be removed per schema
-- without side effects on other schemas, so every migration must still `revoke ... from public`
-- on the functions it creates. 14_hardening_tests.sql fails if any public function is left open.)
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- 2) foreign-key indexes (partial: nullable columns only index the rows that matter) ----------------
create index if not exists admin_audit_log_admin_idx        on public.admin_audit_log (admin_id)         where admin_id is not null;
create index if not exists app_settings_updated_by_idx      on public.app_settings (updated_by)          where updated_by is not null;
create index if not exists balance_ledger_created_by_idx    on public.balance_ledger (created_by)        where created_by is not null;
create index if not exists topup_transfers_credited_user_idx on public.topup_transfers (credited_user_id) where credited_user_id is not null;
create index if not exists topup_transfers_request_idx      on public.topup_transfers (request_id)       where request_id is not null;
create index if not exists topup_transfers_resolved_by_idx  on public.topup_transfers (resolved_by)      where resolved_by is not null;
create index if not exists transactions_product_idx         on public.transactions (product_id)          where product_id is not null;

-- 3) trigram search indexes ------------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;

create index if not exists profiles_email_trgm        on public.profiles       using gin (email        extensions.gin_trgm_ops);
create index if not exists profiles_full_name_trgm    on public.profiles       using gin (full_name    extensions.gin_trgm_ops);
create index if not exists transactions_dest_trgm     on public.transactions   using gin (destination  extensions.gin_trgm_ops);
create index if not exists transactions_product_trgm  on public.transactions   using gin (product_name extensions.gin_trgm_ops);
create index if not exists transactions_reff_trgm     on public.transactions   using gin (reff_id      extensions.gin_trgm_ops);
create index if not exists products_name_trgm         on public.products_cache using gin (name         extensions.gin_trgm_ops);
create index if not exists products_display_name_trgm on public.products_cache using gin (display_name extensions.gin_trgm_ops);
create index if not exists products_code_trgm         on public.products_cache using gin (provider_code extensions.gin_trgm_ops);

-- 4) rate limiter ------------------------------------------------------------------------------------------
-- Fixed windows. One INSERT .. ON CONFLICT DO UPDATE is atomic under the row lock, so N parallel
-- calls count exactly N hits. Keys are hashed by the caller (no IP / e-mail stored in clear).
create table public.rate_limits (
  key          text not null check (length(key) between 1 and 200),
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);
create index rate_limits_window_idx on public.rate_limits (window_start);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from public, anon, authenticated;

create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (out_allowed boolean, out_hits integer, out_retry_after integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_start timestamptz;
  v_hits integer;
begin
  if p_key is null or length(p_key) not between 1 and 200 then raise exception 'invalid key' using errcode = '22023'; end if;
  if p_limit is null or p_limit not between 1 and 100000 then raise exception 'invalid limit' using errcode = '22023'; end if;
  if p_window_seconds is null or p_window_seconds not between 1 and 86400 then raise exception 'invalid window' using errcode = '22023'; end if;

  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  return query select v_hits <= p_limit, v_hits,
    greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now()))))::integer;
end $$;

create or replace function public.rate_limit_cleanup()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.rate_limit_hit(text, integer, integer), public.rate_limit_cleanup() from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer), public.rate_limit_cleanup() to service_role;
