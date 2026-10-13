-- 0009: log of the connection tests run from Admin → Diagnostik (env / Supabase / KhfyPay / webhook).
-- Written only by admin_log_diagnostic (admin re-checked in the database). The app redacts secrets BEFORE it calls this.
-- Keeps the newest 300 rows, so the table can never grow without bound.

create table public.diagnostic_logs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  admin_id    uuid references public.profiles (id) on delete set null,
  check_id    text not null,
  status      text not null check (status in ('pass', 'warn', 'fail', 'skip')),
  code        text not null,
  http_status integer,
  latency_ms  integer,
  summary     text not null,
  detail      text
);
create index diagnostic_logs_admin_idx on public.diagnostic_logs (admin_id);

alter table public.diagnostic_logs enable row level security;   -- no policies: service_role / SECURITY DEFINER only
revoke all on public.diagnostic_logs from public, anon, authenticated;
grant select on public.diagnostic_logs to service_role;
grant select on public.provider_webhook_events to service_role; -- the admin page lists recent callbacks (read-only)

create or replace function public.admin_log_diagnostic(
  p_admin_id uuid, p_check_id text, p_status text, p_code text,
  p_http_status integer, p_latency_ms integer, p_summary text, p_detail text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin(p_admin_id);
  insert into public.diagnostic_logs (admin_id, check_id, status, code, http_status, latency_ms, summary, detail)
  values (p_admin_id, left(coalesce(p_check_id, ''), 40), p_status, left(coalesce(p_code, ''), 60),
          p_http_status, p_latency_ms, left(coalesce(p_summary, ''), 300), left(p_detail, 4000));
  delete from public.diagnostic_logs
   where id <= coalesce((select id from public.diagnostic_logs order by id desc offset 300 limit 1), 0);
end $$;

revoke all on function public.admin_log_diagnostic(uuid, text, text, text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.admin_log_diagnostic(uuid, text, text, text, integer, integer, text, text) to service_role;
