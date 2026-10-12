-- =====================================================================
-- Toko Kuota — 0004_topup  (Tahap 4A: automatic bank-transfer top-up, app side)
--
-- A user asks to top up; the system reserves a UNIQUE transfer amount (base + unique code) for
-- one bank. When a transfer of exactly that amount is reported, the balance is credited ONCE.
--   * nominal uniqueness is enforced by a partial unique index (bank, total) over PENDING requests
--   * crediting is atomic + idempotent: unique(bank_code, bank_ref) per transfer, one PAID per
--     request, unique(type, idempotency_key) in the ledger
--   * late / unmatched / suspicious transfers never credit automatically: they go to a review queue
--   * how a transfer is DETECTED (webhook of a mutation service) is Tahap 4B; record_incoming_transfer
--     takes a provider-neutral shape so nothing here depends on an unknown payload format
-- =====================================================================

-- 1) ledger: new movement type ---------------------------------------------------------------
alter table public.balance_ledger drop constraint balance_ledger_type_check;
alter table public.balance_ledger add constraint balance_ledger_type_check
  check (type in ('PURCHASE', 'REFUND', 'MANUAL_TOPUP', 'ADJUSTMENT', 'TOPUP'));
alter table public.balance_ledger drop constraint balance_ledger_sign;
alter table public.balance_ledger add constraint balance_ledger_sign check (
  (type = 'PURCHASE' and amount < 0) or
  (type in ('REFUND', 'MANUAL_TOPUP', 'TOPUP') and amount > 0) or
  (type = 'ADJUSTMENT')
);

-- 2) settings (defaults; top-up stays DISABLED until an admin turns it on) ----------------------
insert into public.app_settings (key, value) values
  ('topup_enabled',        'false'::jsonb),
  ('topup_min_amount',     '10000'::jsonb),
  ('topup_max_amount',     '2000000'::jsonb),
  ('topup_code_min',       '1'::jsonb),
  ('topup_code_max',       '999'::jsonb),
  ('topup_expiry_minutes', '1440'::jsonb)
on conflict (key) do nothing;

create or replace function public._setting_int(p_key text, p_default integer)
returns integer language sql stable as $$
  select coalesce((select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::numeric::integer end
                     from public.app_settings s where s.key = p_key), p_default);
$$;
create or replace function public._setting_bool(p_key text, p_default boolean)
returns boolean language sql stable as $$
  select coalesce((select case when jsonb_typeof(s.value) = 'boolean' then (s.value #>> '{}')::boolean end
                     from public.app_settings s where s.key = p_key), p_default);
$$;
revoke all on function public._setting_int(text, integer), public._setting_bool(text, boolean) from public, anon, authenticated;

-- admin_update_settings: same function as 0003 + the top-up keys + cross-checks
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
    elsif v_key in ('catalog_default_margin', 'topup_min_amount', 'topup_max_amount', 'topup_code_min', 'topup_code_max', 'topup_expiry_minutes') then
      v_lo := case when v_key in ('topup_min_amount', 'topup_max_amount') then 1 when v_key = 'topup_expiry_minutes' then 5 else 0 end;
      v_hi := case when v_key in ('topup_code_min', 'topup_code_max') then 9999 when v_key = 'topup_expiry_minutes' then 10080 else 1000000000 end;
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

-- 3) banks (account details are entered by an admin; never hard-coded) ------------------------------
create table public.topup_banks (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code ~ '^[A-Z0-9]{2,10}$'),
  bank_name      text not null check (length(bank_name) between 2 and 60),
  account_number text not null check (account_number ~ '^[0-9]{5,30}$'),
  account_holder text not null check (length(account_holder) between 2 and 100),
  is_active      boolean not null default false,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger topup_banks_set_updated_at before update on public.topup_banks
  for each row execute function public.set_updated_at();

-- 4) requests ---------------------------------------------------------------------------------------
create table public.topup_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete restrict,
  bank_id         uuid not null references public.topup_banks (id) on delete restrict,
  bank_code       text not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  base_amount     bigint not null check (base_amount > 0),
  unique_code     integer not null check (unique_code >= 0),
  total_amount    bigint generated always as (base_amount + unique_code) stored,
  status          text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED')),
  expires_at      timestamptz not null,
  paid_at         timestamptz,
  bank_ref        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint topup_requests_user_idem_key unique (user_id, idempotency_key),
  constraint topup_requests_paid_consistent check ((status = 'PAID') = (paid_at is not null))
);
-- THE matching key: at most one PENDING request per (bank, exact transfer amount)
create unique index topup_requests_pending_nominal on public.topup_requests (bank_id, total_amount) where status = 'PENDING';
create index topup_requests_user_created_idx on public.topup_requests (user_id, created_at desc);
create index topup_requests_pending_expiry_idx on public.topup_requests (expires_at) where status = 'PENDING';
create index topup_requests_created_idx on public.topup_requests (created_at desc, id desc);
create trigger topup_requests_set_updated_at before update on public.topup_requests
  for each row execute function public.set_updated_at();

create or replace function public.topup_requests_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'topup requests cannot be deleted' using errcode = '42501'; end if;
  if new.user_id is distinct from old.user_id or new.bank_id is distinct from old.bank_id
     or new.bank_code is distinct from old.bank_code or new.idempotency_key is distinct from old.idempotency_key
     or new.base_amount is distinct from old.base_amount or new.unique_code is distinct from old.unique_code
     or new.expires_at is distinct from old.expires_at or new.created_at is distinct from old.created_at then
    raise exception 'immutable topup column changed' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'PENDING' and new.status in ('PAID', 'EXPIRED', 'CANCELLED')) or (old.status = 'EXPIRED' and new.status = 'PAID')) then
      raise exception 'invalid topup status change % -> %', old.status, new.status using errcode = '42501';
    end if;
    if coalesce(current_setting('app.balance_rpc', true), 'off') <> 'on' then
      raise exception 'topup status can only change through topup RPCs' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger topup_requests_guard_trg before update or delete on public.topup_requests
  for each row execute function public.topup_requests_guard();

-- 5) transfers: every reported incoming transfer, plus the review queue ---------------------------------
create table public.topup_transfers (
  id               uuid primary key default gen_random_uuid(),
  bank_code        text not null,
  bank_ref         text not null check (length(bank_ref) between 1 and 200),
  amount           bigint not null check (amount > 0),
  occurred_at      timestamptz not null,
  status           text not null check (status in ('CREDITED', 'QUEUED', 'RESOLVED', 'IGNORED')),
  reason           text,
  request_id       uuid references public.topup_requests (id) on delete restrict,
  credited_user_id uuid references public.profiles (id) on delete restrict,
  raw              jsonb,
  resolved_by      uuid references public.profiles (id) on delete set null,
  resolved_note    text,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint topup_transfers_ref_key unique (bank_code, bank_ref)   -- the same bank transaction can never be processed twice
);
create index topup_transfers_status_idx on public.topup_transfers (status, created_at desc);

create or replace function public.topup_transfers_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'topup transfers cannot be deleted' using errcode = '42501'; end if;
  if new.bank_code is distinct from old.bank_code or new.bank_ref is distinct from old.bank_ref
     or new.amount is distinct from old.amount or new.occurred_at is distinct from old.occurred_at
     or new.raw is distinct from old.raw or new.created_at is distinct from old.created_at then
    raise exception 'immutable transfer column changed' using errcode = '42501';
  end if;
  if old.status <> 'QUEUED' and (new.status is distinct from old.status or new.reason is distinct from old.reason
      or new.request_id is distinct from old.request_id or new.credited_user_id is distinct from old.credited_user_id) then
    raise exception 'transfer is already final (%)', old.status using errcode = '42501';
  end if;
  if new.status is distinct from old.status and coalesce(current_setting('app.balance_rpc', true), 'off') <> 'on' then
    raise exception 'transfer status can only change through topup RPCs' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger topup_transfers_guard_trg before update or delete on public.topup_transfers
  for each row execute function public.topup_transfers_guard();

-- 6) internal credit (one code path for auto-match, admin confirm, admin resolve) ------------------------
create or replace function public._credit_topup(p_user_id uuid, p_amount bigint, p_idem text, p_note text, p_admin uuid)
returns table (out_ledger_id bigint, out_balance_after bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_profile public.profiles%rowtype;
  v_new bigint;
  v_led bigint;
begin
  select * into v_profile from public.profiles p where p.id = p_user_id for update;
  if not found then raise exception 'user not found' using errcode = '22023'; end if;
  perform set_config('app.balance_rpc', 'on', true);
  v_new := v_profile.saldo + p_amount;
  update public.profiles set saldo = v_new where id = p_user_id;
  insert into public.balance_ledger (user_id, type, amount, balance_before, balance_after, idempotency_key, note, created_by)
  values (p_user_id, 'TOPUP', p_amount, v_profile.saldo, v_new, p_idem, p_note, p_admin)
  returning id into v_led;
  perform set_config('app.balance_rpc', 'off', true);
  return query select v_led, v_new;
end $$;
revoke all on function public._credit_topup(uuid, bigint, text, text, uuid) from public, anon, authenticated;

-- 7) create a request -----------------------------------------------------------------------------------------
create or replace function public.create_topup_request(p_user_id uuid, p_bank_code text, p_base_amount bigint, p_idempotency_key text)
returns table (
  out_outcome text,  -- CREATED | EXISTING | TOPUP_DISABLED | USER_NOT_FOUND | USER_INACTIVE | BANK_UNAVAILABLE
                     -- | AMOUNT_OUT_OF_RANGE | TOO_MANY_PENDING | NO_CODE_AVAILABLE
  out_request_id uuid, out_bank_code text, out_base_amount bigint, out_unique_code integer,
  out_total_amount bigint, out_expires_at timestamptz, out_status text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_profile public.profiles%rowtype;
  v_bank public.topup_banks%rowtype;
  v_req public.topup_requests%rowtype;
  v_min integer := public._setting_int('topup_min_amount', 10000);
  v_max integer := public._setting_int('topup_max_amount', 2000000);
  v_cmin integer := public._setting_int('topup_code_min', 1);
  v_cmax integer := public._setting_int('topup_code_max', 999);
  v_exp integer := public._setting_int('topup_expiry_minutes', 1440);
  v_code integer; v_try integer := 0;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  -- serialise this user's requests (idempotency + the pending cap)
  select * into v_profile from public.profiles p where p.id = p_user_id for update;
  if not found then
    return query select 'USER_NOT_FOUND', null::uuid, null::text, null::bigint, null::integer, null::bigint, null::timestamptz, null::text; return;
  end if;

  select * into v_req from public.topup_requests r where r.user_id = p_user_id and r.idempotency_key = p_idempotency_key;
  if found then
    return query select 'EXISTING', v_req.id, v_req.bank_code, v_req.base_amount, v_req.unique_code, v_req.total_amount, v_req.expires_at, v_req.status; return;
  end if;

  if not public._setting_bool('topup_enabled', false) then
    return query select 'TOPUP_DISABLED', null::uuid, null::text, null::bigint, null::integer, null::bigint, null::timestamptz, null::text; return;
  end if;
  if not v_profile.is_active then
    return query select 'USER_INACTIVE', null::uuid, null::text, null::bigint, null::integer, null::bigint, null::timestamptz, null::text; return;
  end if;

  select * into v_bank from public.topup_banks b where b.code = upper(btrim(coalesce(p_bank_code, ''))) and b.is_active;
  if not found then
    return query select 'BANK_UNAVAILABLE', null::uuid, null::text, null::bigint, null::integer, null::bigint, null::timestamptz, null::text; return;
  end if;

  if p_base_amount is null or p_base_amount < v_min or p_base_amount > v_max then
    return query select 'AMOUNT_OUT_OF_RANGE', null::uuid, null::text, null::bigint, null::integer, null::bigint, null::timestamptz, null::text; return;
  end if;

  -- a user cannot hoard nominals
  if (select count(*) from public.topup_requests r where r.user_id = p_user_id and r.status = 'PENDING' and r.expires_at >= now()) >= 3 then
    return query select 'TOO_MANY_PENDING', null::uuid, null::text, null::bigint, null::integer, null::bigint, null::timestamptz, null::text; return;
  end if;

  while v_try < 25 loop
    v_try := v_try + 1;
    v_code := v_cmin + floor(random() * (v_cmax - v_cmin + 1))::integer;

    -- an expired-but-unswept request must not block its nominal (skip rows another transaction holds)
    perform set_config('app.balance_rpc', 'on', true);
    update public.topup_requests set status = 'EXPIRED'
     where id in (select r.id from public.topup_requests r
                   where r.bank_id = v_bank.id and r.total_amount = p_base_amount + v_code
                     and r.status = 'PENDING' and r.expires_at < now() for update skip locked);
    perform set_config('app.balance_rpc', 'off', true);

    begin
      insert into public.topup_requests (user_id, bank_id, bank_code, idempotency_key, base_amount, unique_code, expires_at)
      values (p_user_id, v_bank.id, v_bank.code, p_idempotency_key, p_base_amount, v_code, now() + make_interval(mins => v_exp))
      returning * into v_req;
      return query select 'CREATED', v_req.id, v_req.bank_code, v_req.base_amount, v_req.unique_code, v_req.total_amount, v_req.expires_at, v_req.status;
      return;
    exception when unique_violation then
      null; -- that exact total is taken by another PENDING request: try another code
    end;
  end loop;

  return query select 'NO_CODE_AVAILABLE', null::uuid, null::text, null::bigint, null::integer, null::bigint, null::timestamptz, null::text;
end $$;

-- 8) user cancels (frees the nominal) ----------------------------------------------------------------------------
create or replace function public.cancel_topup_request(p_user_id uuid, p_request_id uuid)
returns table (out_outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_req public.topup_requests%rowtype;
begin
  select * into v_req from public.topup_requests r where r.id = p_request_id and r.user_id = p_user_id for update;
  if not found then return query select 'NOT_FOUND'; return; end if;
  if v_req.status <> 'PENDING' then return query select 'NOT_PENDING'; return; end if;
  perform set_config('app.balance_rpc', 'on', true);
  update public.topup_requests set status = 'CANCELLED' where id = v_req.id;
  perform set_config('app.balance_rpc', 'off', true);
  return query select 'CANCELLED';
end $$;

-- 9) sweeper -------------------------------------------------------------------------------------------------------
create or replace function public.expire_topup_requests()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  perform set_config('app.balance_rpc', 'on', true);
  update public.topup_requests set status = 'EXPIRED'
   where id in (select r.id from public.topup_requests r where r.status = 'PENDING' and r.expires_at < now() for update skip locked);
  get diagnostics v_n = row_count;
  perform set_config('app.balance_rpc', 'off', true);
  return v_n;
end $$;

-- 10) an incoming transfer was reported (provider-neutral entry point for Tahap 4B) ----------------------------------
create or replace function public.record_incoming_transfer(
  p_bank_code text, p_amount bigint, p_bank_ref text, p_occurred_at timestamptz default null, p_raw jsonb default null)
returns table (out_outcome text, out_transfer_id uuid, out_request_id uuid, out_user_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_tr public.topup_transfers%rowtype;
  v_req public.topup_requests%rowtype;
  v_profile public.profiles%rowtype;
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_reason text;
  v_ledger bigint;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then raise exception 'invalid amount' using errcode = '22023'; end if;
  if p_bank_ref is null or btrim(p_bank_ref) = '' then raise exception 'bank_ref is required' using errcode = '22023'; end if;
  if p_bank_code is null or p_bank_code !~ '^[A-Z0-9]{2,10}$' then raise exception 'invalid bank code' using errcode = '22023'; end if;

  insert into public.topup_transfers (bank_code, bank_ref, amount, occurred_at, status, raw)
  values (p_bank_code, btrim(p_bank_ref), p_amount, v_at, 'QUEUED', p_raw)
  on conflict (bank_code, bank_ref) do nothing
  returning * into v_tr;

  if not found then   -- the same bank transaction was reported before: no second effect
    select * into v_tr from public.topup_transfers t where t.bank_code = p_bank_code and t.bank_ref = btrim(p_bank_ref);
    return query select 'ALREADY_RECORDED', v_tr.id, v_tr.request_id, v_tr.credited_user_id;
    return;
  end if;

  select * into v_req from public.topup_requests r
   where r.bank_code = p_bank_code and r.total_amount = p_amount and r.status = 'PENDING' for update;

  if not found then
    v_reason := case when exists (select 1 from public.topup_requests r where r.bank_code = p_bank_code and r.total_amount = p_amount
                                     and r.status = 'PAID' and r.paid_at > now() - interval '3 days')
                     then 'MATCHES_PAID_REQUEST' else 'NO_MATCH' end;
    update public.topup_transfers set reason = v_reason where id = v_tr.id;
    return query select 'QUEUED', v_tr.id, null::uuid, null::uuid;
    return;
  end if;

  if v_at > v_req.expires_at then   -- judged by WHEN the money arrived, not when we heard about it
    perform set_config('app.balance_rpc', 'on', true);
    update public.topup_requests set status = 'EXPIRED' where id = v_req.id;
    perform set_config('app.balance_rpc', 'off', true);
    update public.topup_transfers set reason = 'EXPIRED', request_id = v_req.id where id = v_tr.id;
    return query select 'QUEUED', v_tr.id, v_req.id, v_req.user_id;
    return;
  end if;

  select * into v_profile from public.profiles p where p.id = v_req.user_id for update;
  if not v_profile.is_active then
    update public.topup_transfers set reason = 'USER_INACTIVE', request_id = v_req.id where id = v_tr.id;
    return query select 'QUEUED', v_tr.id, v_req.id, v_req.user_id;
    return;
  end if;

  select c.out_ledger_id into v_ledger from public._credit_topup(v_req.user_id, v_req.total_amount, 'req:' || v_req.id::text,
    'Top-up ' || v_req.bank_code || ' ' || v_req.total_amount::text, null) c;

  perform set_config('app.balance_rpc', 'on', true);
  update public.topup_requests set status = 'PAID', paid_at = now(), bank_ref = btrim(p_bank_ref) where id = v_req.id;
  update public.topup_transfers set status = 'CREDITED', request_id = v_req.id, credited_user_id = v_req.user_id where id = v_tr.id;
  perform set_config('app.balance_rpc', 'off', true);

  return query select 'CREDITED', v_tr.id, v_req.id, v_req.user_id;
end $$;

-- 11) admin: confirm a request by hand (checked the bank app) ------------------------------------------------------
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
  select * into v_req from public.topup_requests r where r.id = p_request_id for update;
  if not found then return query select 'NOT_FOUND', null::bigint; return; end if;
  if v_req.status = 'PAID' then return query select 'ALREADY_APPLIED', null::bigint; return; end if;
  if v_req.status = 'CANCELLED' then return query select 'CANCELLED', null::bigint; return; end if;

  select c.out_balance_after into v_bal from public._credit_topup(v_req.user_id, v_req.total_amount, 'req:' || v_req.id::text,
    'Top-up ' || v_req.bank_code || ' ' || v_req.total_amount::text || ' (dikonfirmasi admin)', p_admin_id) c;

  perform set_config('app.balance_rpc', 'on', true);
  update public.topup_requests set status = 'PAID', paid_at = now(), bank_ref = 'admin:' || p_admin_id::text where id = v_req.id;
  perform set_config('app.balance_rpc', 'off', true);

  perform public._audit(p_admin_id, 'confirm_topup_request', 'topup_request', v_req.id::text,
    jsonb_build_object('user_id', v_req.user_id, 'amount', v_req.total_amount, 'previous_status', v_req.status, 'note', btrim(p_note)));
  return query select 'APPLIED', v_bal;
end $$;

-- 12) admin: resolve a queued transfer ------------------------------------------------------------------------------
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
  select * into v_tr from public.topup_transfers t where t.id = p_transfer_id for update;
  if not found then return query select 'NOT_FOUND', null::bigint; return; end if;
  if v_tr.status <> 'QUEUED' then return query select 'NOT_QUEUED', null::bigint; return; end if;

  if p_action = 'CREDIT' then
    if p_user_id is null or not exists (select 1 from public.profiles p where p.id = p_user_id) then
      raise exception 'a valid user is required to credit' using errcode = '22023';
    end if;
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

-- 13) admin: bank accounts --------------------------------------------------------------------------------------------
create or replace function public.admin_upsert_topup_bank(
  p_admin_id uuid, p_code text, p_bank_name text, p_account_number text, p_account_holder text, p_is_active boolean, p_sort_order integer default 0)
returns table (out_outcome text)  -- CREATED | UPDATED | HAS_PENDING_REQUESTS
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_old public.topup_banks%rowtype;
begin
  perform public._require_admin(p_admin_id);
  select * into v_old from public.topup_banks b where b.code = p_code for update;
  if found then
    -- changing where money must be sent while users are mid-payment would misdirect their transfers
    if (v_old.account_number <> p_account_number or v_old.account_holder <> p_account_holder)
       and exists (select 1 from public.topup_requests r where r.bank_id = v_old.id and r.status = 'PENDING' and r.expires_at >= now()) then
      return query select 'HAS_PENDING_REQUESTS'; return;
    end if;
    update public.topup_banks set bank_name = p_bank_name, account_number = p_account_number, account_holder = p_account_holder,
           is_active = p_is_active, sort_order = p_sort_order where id = v_old.id;
    perform public._audit(p_admin_id, 'update_topup_bank', 'topup_bank', v_old.id::text, jsonb_build_object('code', p_code,
      'is_active', p_is_active, 'account_changed', (v_old.account_number <> p_account_number or v_old.account_holder <> p_account_holder)));
    return query select 'UPDATED';
  else
    insert into public.topup_banks (code, bank_name, account_number, account_holder, is_active, sort_order)
    values (p_code, p_bank_name, p_account_number, p_account_holder, p_is_active, p_sort_order);
    perform public._audit(p_admin_id, 'create_topup_bank', 'topup_bank', p_code, jsonb_build_object('code', p_code, 'is_active', p_is_active));
    return query select 'CREATED';
  end if;
end $$;

-- 14) admin reads + dashboard counters -------------------------------------------------------------------------------
create or replace function public.admin_list_topups(p_status text default null, p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, user_id uuid, user_email text, bank_code text, base_amount bigint, unique_code integer, total_amount bigint,
               status text, expires_at timestamptz, paid_at timestamptz, bank_ref text, created_at timestamptz)
language sql stable as $$
  select r.id, r.user_id, u.email, r.bank_code, r.base_amount, r.unique_code, r.total_amount, r.status, r.expires_at, r.paid_at, r.bank_ref, r.created_at
    from public.topup_requests r join public.profiles u on u.id = r.user_id
   where (p_status is null or r.status = p_status)
     and (coalesce(p_search, '') = '' or u.email ilike public._like(p_search) or r.total_amount::text like public._like(p_search))
   order by r.created_at desc, r.id
   limit least(greatest(p_limit, 1), 101) offset greatest(p_offset, 0);
$$;

create or replace function public.admin_list_transfers(p_status text default null, p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, bank_code text, bank_ref text, amount bigint, occurred_at timestamptz, status text, reason text, request_id uuid,
               credited_user_id uuid, credited_user_email text, resolved_note text, created_at timestamptz)
language sql stable as $$
  select t.id, t.bank_code, t.bank_ref, t.amount, t.occurred_at, t.status, t.reason, t.request_id, t.credited_user_id, u.email, t.resolved_note, t.created_at
    from public.topup_transfers t left join public.profiles u on u.id = t.credited_user_id
   where (p_status is null or t.status = p_status)
   order by t.created_at desc, t.id
   limit least(greatest(p_limit, 1), 101) offset greatest(p_offset, 0);
$$;

create or replace function public.admin_dashboard_stats(p_since timestamptz)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'users_total',    (select count(*) from public.profiles),
    'users_active',   (select count(*) from public.profiles where is_active),
    'saldo_total',    (select coalesce(sum(saldo), 0) from public.profiles),
    'since_pending',  (select count(*) from public.transactions where created_at >= p_since and status = 'PENDING'),
    'since_success',  (select count(*) from public.transactions where created_at >= p_since and status = 'SUCCESS'),
    'since_failed',   (select count(*) from public.transactions where created_at >= p_since and status = 'FAILED'),
    'since_revenue',  (select coalesce(sum(sell_price), 0) from public.transactions where created_at >= p_since and status = 'SUCCESS'),
    'since_profit',   (select coalesce(sum(sell_price - cost_price), 0) from public.transactions where created_at >= p_since and status = 'SUCCESS'),
    'pending_total',  (select count(*) from public.transactions where status = 'PENDING'),
    'unsent',         (select count(*) from public.transactions where status = 'PENDING' and provider_attempts = 0 and created_at < now() - interval '2 minutes'),
    'stale_pending',  (select count(*) from public.transactions where status = 'PENDING' and provider_attempts > 0 and created_at < now() - interval '10 minutes'),
    'needs_review',   (select count(*) from public.transactions where needs_review),
    'webhook_unresolved_24h', (select count(*) from public.provider_webhook_events
                                where last_received_at >= now() - interval '24 hours'
                                  and outcome is distinct from 'APPLIED' and outcome is distinct from 'ALREADY_APPLIED'),
    'topup_pending',  (select count(*) from public.topup_requests where status = 'PENDING' and expires_at >= now()),
    'topup_queued',   (select count(*) from public.topup_transfers where status = 'QUEUED')
  );
$$;

-- 15) RLS + grants ----------------------------------------------------------------------------------------------------------
alter table public.topup_banks     enable row level security;
alter table public.topup_requests  enable row level security;
alter table public.topup_transfers enable row level security;
revoke all on public.topup_banks, public.topup_requests, public.topup_transfers from public, anon, authenticated;

-- users read ONLY their own requests, column-limited (bank details are served by the server; transfers never)
create policy topup_requests_select_own on public.topup_requests for select to authenticated using (user_id = (select auth.uid()));
grant select (id, bank_code, base_amount, unique_code, total_amount, status, expires_at, paid_at, created_at)
  on public.topup_requests to authenticated;

grant select on public.topup_banks, public.topup_requests, public.topup_transfers to service_role;

revoke all on function
  public.create_topup_request(uuid, text, bigint, text), public.cancel_topup_request(uuid, uuid), public.expire_topup_requests(),
  public.record_incoming_transfer(text, bigint, text, timestamptz, jsonb),
  public.admin_confirm_topup_request(uuid, uuid, text), public.admin_resolve_transfer(uuid, uuid, text, uuid, text),
  public.admin_upsert_topup_bank(uuid, text, text, text, text, boolean, integer),
  public.admin_list_topups(text, text, integer, integer), public.admin_list_transfers(text, integer, integer)
  from public, anon, authenticated;
grant execute on function
  public.create_topup_request(uuid, text, bigint, text), public.cancel_topup_request(uuid, uuid), public.expire_topup_requests(),
  public.record_incoming_transfer(text, bigint, text, timestamptz, jsonb),
  public.admin_confirm_topup_request(uuid, uuid, text), public.admin_resolve_transfer(uuid, uuid, text, uuid, text),
  public.admin_upsert_topup_bank(uuid, text, text, text, text, boolean, integer),
  public.admin_list_topups(text, text, integer, integer), public.admin_list_transfers(text, integer, integer)
  to service_role;
