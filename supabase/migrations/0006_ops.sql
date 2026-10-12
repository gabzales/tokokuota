-- =====================================================================
-- Toko Kuota — 0006_ops
--  1. per-admin daily cap on manual credits (limits the damage of one compromised admin)
--  2. audited CSV export queries (transactions, ledger)
-- =====================================================================

-- 1) cap ---------------------------------------------------------------------------------------------
insert into public.app_settings (key, value) values ('admin_credit_daily_cap', '10000000'::jsonb) on conflict (key) do nothing;

-- admin_update_settings: same as 0004 + admin_credit_daily_cap (1 .. 2.000.000.000)
create or replace function public.admin_update_settings(p_admin_id uuid, p_changes jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text; v_val jsonb; v_lo numeric; v_hi numeric;
begin
  perform public._require_admin(p_admin_id);
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'no changes given' using errcode = '22023';
  end if;

  for v_key, v_val in select * from jsonb_each(p_changes) loop
    if v_key in ('maintenance_mode', 'catalog_activate_new', 'topup_enabled') then
      if jsonb_typeof(v_val) <> 'boolean' then raise exception '% must be boolean', v_key using errcode = '22023'; end if;
    elsif v_key in ('catalog_default_margin', 'topup_min_amount', 'topup_max_amount', 'topup_code_min', 'topup_code_max', 'topup_expiry_minutes', 'admin_credit_daily_cap') then
      v_lo := case when v_key in ('topup_min_amount', 'topup_max_amount', 'admin_credit_daily_cap') then 1 when v_key = 'topup_expiry_minutes' then 5 else 0 end;
      v_hi := case when v_key in ('topup_code_min', 'topup_code_max') then 9999 when v_key = 'topup_expiry_minutes' then 10080
                   when v_key = 'admin_credit_daily_cap' then 2000000000 else 1000000000 end;
      if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)
         or (v_val #>> '{}')::numeric < v_lo or (v_val #>> '{}')::numeric > v_hi then
        raise exception '% must be an integer between % and %', v_key, v_lo, v_hi using errcode = '22023';
      end if;
    elsif v_key = 'support_contact' then
      if jsonb_typeof(v_val) <> 'string' or length(v_val #>> '{}') > 100 then raise exception 'support_contact too long' using errcode = '22023'; end if;
    elsif v_key = 'announcement' then
      if jsonb_typeof(v_val) <> 'string' or length(v_val #>> '{}') > 300 then raise exception 'announcement too long' using errcode = '22023'; end if;
    else
      raise exception 'unknown setting %', v_key using errcode = '22023';
    end if;
  end loop;

  for v_key, v_val in select * from jsonb_each(p_changes) loop
    insert into public.app_settings (key, value, updated_at, updated_by)
    values (v_key, v_val, now(), p_admin_id)
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = p_admin_id;
  end loop;

  if public._setting_int('topup_min_amount', 1) > public._setting_int('topup_max_amount', 1)
     or public._setting_int('topup_code_min', 0) > public._setting_int('topup_code_max', 0) then
    raise exception 'minimum must not exceed maximum' using errcode = '22023';
  end if;

  perform public._audit(p_admin_id, 'update_settings', 'settings', null, p_changes);
end $$;

-- Serialises one admin's credits so two parallel requests cannot both slip under the cap.
create or replace function public._lock_admin_credit(p_admin uuid)
returns void language sql as $$
  select pg_advisory_xact_lock(hashtextextended('admin_credit:' || p_admin::text, 0));
$$;

-- Sums what THIS admin credited by hand in the last 24h (manual top-up, confirmed requests, resolved transfers).
-- Automatic credits (real transfer matched to a request) do not count: they need real money.
create or replace function public._check_admin_credit_cap(p_admin uuid, p_amount bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cap  bigint := public._setting_int('admin_credit_daily_cap', 10000000);
  v_used bigint;
begin
  select coalesce(sum(l.amount), 0) into v_used from public.balance_ledger l
   where l.created_by = p_admin and l.type in ('MANUAL_TOPUP', 'TOPUP') and l.created_at > now() - interval '24 hours';
  if v_used + p_amount > v_cap then
    raise exception 'daily credit cap exceeded (used %, cap %)', v_used, v_cap using errcode = '54000';
  end if;
end $$;

revoke all on function public._lock_admin_credit(uuid), public._check_admin_credit_cap(uuid, bigint) from public, anon, authenticated;

-- admin_manual_topup (0003) + cap
create or replace function public.admin_manual_topup(
  p_admin_id uuid, p_user_id uuid, p_amount bigint, p_idempotency_key text, p_note text default null)
returns table (out_outcome text, out_ledger_id bigint, out_balance_after bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_admin   public.profiles%rowtype;
  v_profile public.profiles%rowtype;
  v_led     public.balance_ledger%rowtype;
  v_new     bigint;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  if p_amount > 1000000000 then raise exception 'amount too large' using errcode = '22023'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  select * into v_admin from public.profiles p where p.id = p_admin_id;
  if not found or v_admin.role <> 'admin' or not v_admin.is_active then
    raise exception 'caller is not an active admin' using errcode = '42501';
  end if;
  perform public._lock_admin_credit(p_admin_id);

  select * into v_profile from public.profiles p where p.id = p_user_id for update;
  if not found then return query select 'USER_NOT_FOUND', null::bigint, null::bigint; return; end if;

  select * into v_led from public.balance_ledger l where l.type = 'MANUAL_TOPUP' and l.idempotency_key = p_idempotency_key;
  if found then
    if v_led.user_id <> p_user_id then raise exception 'idempotency key already used for another user' using errcode = '22023'; end if;
    return query select 'ALREADY_APPLIED', v_led.id, v_led.balance_after; return;
  end if;

  perform public._check_admin_credit_cap(p_admin_id, p_amount);

  perform set_config('app.balance_rpc', 'on', true);
  v_new := v_profile.saldo + p_amount;
  update public.profiles set saldo = v_new where id = p_user_id;
  insert into public.balance_ledger (user_id, type, amount, balance_before, balance_after, idempotency_key, note, created_by)
  values (p_user_id, 'MANUAL_TOPUP', p_amount, v_profile.saldo, v_new, p_idempotency_key, p_note, p_admin_id)
  returning * into v_led;
  perform set_config('app.balance_rpc', 'off', true);

  perform public._audit(p_admin_id, 'manual_topup', 'user', p_user_id::text,
    jsonb_build_object('amount', p_amount, 'ledger_id', v_led.id, 'note', p_note));
  return query select 'APPLIED', v_led.id, v_new;
end $$;

-- admin_confirm_topup_request (0004) + cap
create or replace function public.admin_confirm_topup_request(p_admin_id uuid, p_request_id uuid, p_note text)
returns table (out_outcome text, out_balance_after bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_req public.topup_requests%rowtype;
  v_bal bigint;
begin
  perform public._require_admin(p_admin_id);
  if p_note is null or length(btrim(p_note)) < 3 or length(p_note) > 300 then
    raise exception 'a note of 3-300 characters is required' using errcode = '22023';
  end if;
  perform public._lock_admin_credit(p_admin_id);

  select * into v_req from public.topup_requests r where r.id = p_request_id for update;
  if not found then return query select 'NOT_FOUND', null::bigint; return; end if;
  if v_req.status = 'PAID' then return query select 'ALREADY_APPLIED', null::bigint; return; end if;
  if v_req.status = 'CANCELLED' then return query select 'CANCELLED', null::bigint; return; end if;

  perform public._check_admin_credit_cap(p_admin_id, v_req.total_amount);

  select c.out_balance_after into v_bal from public._credit_topup(v_req.user_id, v_req.total_amount, 'req:' || v_req.id::text,
    'Top-up ' || v_req.bank_code || ' ' || v_req.total_amount::text || ' (dikonfirmasi admin)', p_admin_id) c;

  perform set_config('app.balance_rpc', 'on', true);
  update public.topup_requests set status = 'PAID', paid_at = now(), bank_ref = 'admin:' || p_admin_id::text where id = v_req.id;
  perform set_config('app.balance_rpc', 'off', true);

  perform public._audit(p_admin_id, 'confirm_topup_request', 'topup_request', v_req.id::text,
    jsonb_build_object('user_id', v_req.user_id, 'amount', v_req.total_amount, 'previous_status', v_req.status, 'note', btrim(p_note)));
  return query select 'APPLIED', v_bal;
end $$;

-- admin_resolve_transfer (0004) + cap (only when crediting)
create or replace function public.admin_resolve_transfer(p_admin_id uuid, p_transfer_id uuid, p_action text, p_user_id uuid, p_note text)
returns table (out_outcome text, out_balance_after bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_tr public.topup_transfers%rowtype;
  v_bal bigint;
begin
  perform public._require_admin(p_admin_id);
  if p_action not in ('CREDIT', 'IGNORE') then raise exception 'action must be CREDIT or IGNORE' using errcode = '22023'; end if;
  if p_note is null or length(btrim(p_note)) < 3 or length(p_note) > 300 then
    raise exception 'a note of 3-300 characters is required' using errcode = '22023';
  end if;
  if p_action = 'CREDIT' then perform public._lock_admin_credit(p_admin_id); end if;

  select * into v_tr from public.topup_transfers t where t.id = p_transfer_id for update;
  if not found then return query select 'NOT_FOUND', null::bigint; return; end if;
  if v_tr.status <> 'QUEUED' then return query select 'NOT_QUEUED', null::bigint; return; end if;

  if p_action = 'CREDIT' then
    if p_user_id is null or not exists (select 1 from public.profiles p where p.id = p_user_id) then
      raise exception 'a valid user is required to credit' using errcode = '22023';
    end if;
    perform public._check_admin_credit_cap(p_admin_id, v_tr.amount);
    select c.out_balance_after into v_bal from public._credit_topup(p_user_id, v_tr.amount, 'transfer:' || v_tr.id::text,
      'Top-up ' || v_tr.bank_code || ' ' || v_tr.amount::text || ' (transfer ' || v_tr.bank_ref || ', dikredit admin)', p_admin_id) c;
  end if;

  perform set_config('app.balance_rpc', 'on', true);
  update public.topup_transfers
     set status = case when p_action = 'CREDIT' then 'RESOLVED' else 'IGNORED' end,
         credited_user_id = case when p_action = 'CREDIT' then p_user_id else null end,
         resolved_by = p_admin_id, resolved_note = btrim(p_note), resolved_at = now()
   where id = v_tr.id;
  perform set_config('app.balance_rpc', 'off', true);

  perform public._audit(p_admin_id, 'resolve_transfer', 'topup_transfer', v_tr.id::text,
    jsonb_build_object('action', p_action, 'amount', v_tr.amount, 'bank_ref', v_tr.bank_ref, 'user_id', p_user_id, 'note', btrim(p_note)));
  return query select case when p_action = 'CREDIT' then 'CREDITED' else 'IGNORED' end, v_bal;
end $$;

-- 2) exports (audited; max 366 days; first 10001 rows so the app can tell "truncated") ----------------------------------
create or replace function public.admin_export_transactions(p_admin_id uuid, p_from timestamptz, p_to timestamptz, p_status text default null)
returns table (created_at timestamptz, reff_id text, user_email text, product_name text, provider_code text, destination text,
               cost_price bigint, sell_price bigint, profit bigint, status text, provider_attempts integer, needs_review boolean, finalized_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  perform public._require_admin(p_admin_id);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days' then
    raise exception 'invalid date range (max 366 days)' using errcode = '22023';
  end if;
  perform public._audit(p_admin_id, 'export_transactions', 'transactions', null,
    jsonb_build_object('from', p_from, 'to', p_to, 'status', p_status));
  return query
    select t.created_at, t.reff_id, u.email, t.product_name, t.provider_code, t.destination, t.cost_price, t.sell_price,
           t.sell_price - t.cost_price, t.status, t.provider_attempts, t.needs_review, t.finalized_at
      from public.transactions t join public.profiles u on u.id = t.user_id
     where t.created_at >= p_from and t.created_at < p_to and (p_status is null or t.status = p_status)
     order by t.created_at, t.id limit 10001;
end $$;

create or replace function public.admin_export_ledger(p_admin_id uuid, p_from timestamptz, p_to timestamptz, p_type text default null)
returns table (created_at timestamptz, user_email text, type text, amount bigint, balance_before bigint, balance_after bigint,
               transaction_reff_id text, note text, created_by_email text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  perform public._require_admin(p_admin_id);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days' then
    raise exception 'invalid date range (max 366 days)' using errcode = '22023';
  end if;
  perform public._audit(p_admin_id, 'export_ledger', 'balance_ledger', null,
    jsonb_build_object('from', p_from, 'to', p_to, 'type', p_type));
  return query
    select l.created_at, u.email, l.type, l.amount, l.balance_before, l.balance_after, t.reff_id, l.note, a.email
      from public.balance_ledger l
      join public.profiles u on u.id = l.user_id
      left join public.transactions t on t.id = l.transaction_id
      left join public.profiles a on a.id = l.created_by
     where l.created_at >= p_from and l.created_at < p_to and (p_type is null or l.type = p_type)
     order by l.created_at, l.id limit 10001;
end $$;

revoke all on function public.admin_export_transactions(uuid, timestamptz, timestamptz, text), public.admin_export_ledger(uuid, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.admin_export_transactions(uuid, timestamptz, timestamptz, text), public.admin_export_ledger(uuid, timestamptz, timestamptz, text)
  to service_role;
