-- GABUNGAN migrasi 0001..0008, urut. Tempel SEKALI di Supabase SQL Editor lalu Run. JANGAN dijalankan dua kali.
-- Kalau sempat error / sudah terlanjur jalan sebagian: Run supabase/00_RESET_DB.sql dulu (project baru saja), lalu file ini lagi.
-- (Sumber kebenaran tetap supabase/migrations/.)

-- ===== 0001_core.sql =====
-- =====================================================================
-- Toko Kuota — 0001_core
-- Profiles, products cache, transactions, balance ledger, webhook audit,
-- RLS, grants and the atomic balance RPCs.
--
-- Money rule: every change to profiles.saldo happens inside one of the
-- SECURITY DEFINER functions below, in the same transaction as its
-- balance_ledger row. Triggers reject any other path.
-- All amounts are integer rupiah (bigint). No floats anywhere.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'user' check (role in ('user', 'admin')),
  saldo       bigint not null default 0 check (saldo >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- saldo may only change while a balance RPC has raised the transaction-local flag.
create or replace function public.profiles_guard()
returns trigger language plpgsql as $$
begin
  if new.saldo is distinct from old.saldo
     and coalesce(current_setting('app.balance_rpc', true), 'off') <> 'on' then
    raise exception 'profiles.saldo can only be changed through balance RPCs'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_guard_trg
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- Auto-create a profile for every new auth user. Role is NEVER read from
-- user metadata (users control that); everyone starts as 'user' with 0 saldo.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- products_cache  (provider catalogue + our margin)
-- sell_price is derived in the database; the frontend never supplies a price.
-- NOTE for the sync job (Tahap 2): upsert must NOT overwrite margin / is_active.
-- ---------------------------------------------------------------------
create table public.products_cache (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null default 'khfypay',
  provider_code text not null,
  name          text not null,
  category      text,
  cost_price    bigint not null check (cost_price >= 0),
  margin        bigint not null default 0 check (margin >= 0),
  sell_price    bigint generated always as (cost_price + margin) stored,
  is_active     boolean not null default true,    -- our switch (admin)
  is_available  boolean not null default true,    -- provider stock / disruption
  raw           jsonb,                            -- untouched provider payload (no invented fields)
  synced_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint products_cache_provider_code_key unique (provider, provider_code),
  constraint products_cache_sell_price_positive check (cost_price + margin > 0)
);

create trigger products_cache_set_updated_at
  before update on public.products_cache
  for each row execute function public.set_updated_at();

create index products_cache_active_category_idx
  on public.products_cache (is_active, category);

-- ---------------------------------------------------------------------
-- transactions
-- reff_id is generated once, server-side, and never changes: every retry of
-- the same purchase reuses it. idempotency_key makes the checkout call safe
-- against double clicks / client retries.
-- ---------------------------------------------------------------------
create table public.transactions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles (id) on delete restrict,
  reff_id               text not null,
  idempotency_key       text not null check (length(idempotency_key) between 8 and 128),
  product_id            uuid references public.products_cache (id) on delete set null,
  provider              text not null default 'khfypay',
  provider_code         text not null,              -- snapshot at purchase time
  product_name          text not null,              -- snapshot
  destination           text not null check (length(destination) between 3 and 64),
  cost_price            bigint not null check (cost_price >= 0),   -- snapshot
  sell_price            bigint not null check (sell_price > 0),    -- snapshot = amount charged
  status                text not null default 'PENDING' check (status in ('PENDING', 'SUCCESS', 'FAILED')),
  provider_message      text,
  provider_raw          jsonb,
  provider_attempts     integer not null default 0,
  provider_submitted_at timestamptz,
  last_reconciled_at    timestamptz,
  needs_review          boolean not null default false,
  review_note           text,
  finalized_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint transactions_reff_id_key unique (reff_id),
  constraint transactions_user_idem_key unique (user_id, idempotency_key),
  constraint transactions_finalized_consistent
    check ((status = 'PENDING') = (finalized_at is null))
);

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

create index transactions_user_created_idx on public.transactions (user_id, created_at desc);
create index transactions_pending_idx      on public.transactions (created_at) where status = 'PENDING';
create index transactions_review_idx       on public.transactions (created_at) where needs_review;

create or replace function public.transactions_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'transactions cannot be deleted' using errcode = '42501';
  end if;

  if new.user_id         is distinct from old.user_id
  or new.reff_id         is distinct from old.reff_id
  or new.idempotency_key is distinct from old.idempotency_key
  or new.product_id      is distinct from old.product_id
  or new.provider        is distinct from old.provider
  or new.provider_code   is distinct from old.provider_code
  or new.product_name    is distinct from old.product_name
  or new.destination     is distinct from old.destination
  or new.cost_price      is distinct from old.cost_price
  or new.sell_price      is distinct from old.sell_price
  or new.created_at      is distinct from old.created_at then
    raise exception 'immutable transaction column changed' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'PENDING' then
      raise exception 'transaction % is already final (%)', old.reff_id, old.status using errcode = '42501';
    end if;
    if coalesce(current_setting('app.balance_rpc', true), 'off') <> 'on' then
      raise exception 'status can only change through finalize RPCs' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger transactions_guard_trg
  before update or delete on public.transactions
  for each row execute function public.transactions_guard();

-- ---------------------------------------------------------------------
-- balance_ledger  (append-only audit of every saldo movement)
-- amount is signed: debits negative, credits positive.
-- Unique (transaction_id, type) => at most ONE purchase debit and ONE refund
-- per transaction, enforced by the database itself.
-- ---------------------------------------------------------------------
create table public.balance_ledger (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles (id) on delete restrict,
  type            text not null check (type in ('PURCHASE', 'REFUND', 'MANUAL_TOPUP', 'ADJUSTMENT')),
  amount          bigint not null check (amount <> 0),
  balance_before  bigint not null check (balance_before >= 0),
  balance_after   bigint not null check (balance_after >= 0),
  transaction_id  uuid references public.transactions (id) on delete restrict,
  idempotency_key text,
  note            text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint balance_ledger_math check (balance_after = balance_before + amount),
  constraint balance_ledger_sign check (
    (type = 'PURCHASE'     and amount < 0) or
    (type = 'REFUND'       and amount > 0) or
    (type = 'MANUAL_TOPUP' and amount > 0) or
    (type = 'ADJUSTMENT')
  ),
  constraint balance_ledger_tx_required check (
    type not in ('PURCHASE', 'REFUND') or transaction_id is not null
  )
);

create unique index balance_ledger_one_per_tx_type
  on public.balance_ledger (transaction_id, type) where transaction_id is not null;
create unique index balance_ledger_idem_key
  on public.balance_ledger (type, idempotency_key) where idempotency_key is not null;
create index balance_ledger_user_created_idx
  on public.balance_ledger (user_id, created_at desc, id desc);
create index balance_ledger_tx_idx
  on public.balance_ledger (transaction_id) where transaction_id is not null;

create or replace function public.balance_ledger_guard()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'balance_ledger is append-only' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.balance_rpc', true), 'off') <> 'on' then
    raise exception 'ledger rows can only be written by balance RPCs' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger balance_ledger_guard_trg
  before insert or update or delete on public.balance_ledger
  for each row execute function public.balance_ledger_guard();

-- ---------------------------------------------------------------------
-- provider_webhook_events  (audit log only)
-- Idempotency lives in the finalize RPCs (state machine), NOT here: if this
-- table suppressed reprocessing, a crash between "logged" and "finalized"
-- would lose the callback forever.
-- ---------------------------------------------------------------------
create table public.provider_webhook_events (
  id                bigint generated always as identity primary key,
  provider          text not null,
  dedupe_key        text not null,                 -- e.g. sha256 of the raw callback
  reff_id           text,
  payload           jsonb not null,
  receive_count     integer not null default 1,
  outcome           text,
  first_received_at timestamptz not null default now(),
  last_received_at  timestamptz not null default now(),
  constraint provider_webhook_events_key unique (provider, dedupe_key)
);

-- =====================================================================
-- Atomic balance RPCs  (SECURITY DEFINER, service_role only)
-- Lock order everywhere:  transactions row  ->  profiles row.
-- =====================================================================

-- 1) Reserve balance + create PENDING transaction ---------------------
create or replace function public.reserve_balance_and_create_transaction(
  p_user_id         uuid,
  p_product_id      uuid,
  p_destination     text,
  p_idempotency_key text
)
returns table (
  out_outcome       text,   -- CREATED | EXISTING | USER_NOT_FOUND | USER_INACTIVE | INVALID_DESTINATION
                            -- | PRODUCT_UNAVAILABLE | INSUFFICIENT_BALANCE
  out_tx_id         uuid,
  out_reff_id       text,
  out_status        text,
  out_amount        bigint,
  out_balance_after bigint
)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_profile public.profiles%rowtype;
  v_product public.products_cache%rowtype;
  v_tx      public.transactions%rowtype;
  v_dest    text := btrim(coalesce(p_destination, ''));
  v_new     bigint;
  v_reff    text;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  -- Lock the user's balance row first: serialises every balance change for this user,
  -- including two concurrent checkouts that carry the same idempotency key.
  select * into v_profile from public.profiles p where p.id = p_user_id for update;
  if not found then
    return query select 'USER_NOT_FOUND', null::uuid, null::text, null::text, null::bigint, null::bigint;
    return;
  end if;

  -- Same key => same transaction, never a second debit.
  select * into v_tx from public.transactions t
   where t.user_id = p_user_id and t.idempotency_key = p_idempotency_key;
  if found then
    return query select 'EXISTING', v_tx.id, v_tx.reff_id, v_tx.status, v_tx.sell_price, v_profile.saldo;
    return;
  end if;

  if not v_profile.is_active then
    return query select 'USER_INACTIVE', null::uuid, null::text, null::text, null::bigint, v_profile.saldo;
    return;
  end if;

  if length(v_dest) not between 3 and 64 then
    return query select 'INVALID_DESTINATION', null::uuid, null::text, null::text, null::bigint, v_profile.saldo;
    return;
  end if;

  -- Price comes from the database, never from the caller.
  select * into v_product from public.products_cache pc where pc.id = p_product_id;
  if not found or not v_product.is_active or not v_product.is_available then
    return query select 'PRODUCT_UNAVAILABLE', null::uuid, null::text, null::text, null::bigint, v_profile.saldo;
    return;
  end if;

  if v_profile.saldo < v_product.sell_price then
    return query select 'INSUFFICIENT_BALANCE', null::uuid, null::text, null::text, v_product.sell_price, v_profile.saldo;
    return;
  end if;

  perform set_config('app.balance_rpc', 'on', true);

  v_new  := v_profile.saldo - v_product.sell_price;
  v_reff := 'TK' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 18));

  update public.profiles set saldo = v_new where id = p_user_id;

  insert into public.transactions
    (user_id, reff_id, idempotency_key, product_id, provider, provider_code,
     product_name, destination, cost_price, sell_price, status)
  values
    (p_user_id, v_reff, p_idempotency_key, v_product.id, v_product.provider, v_product.provider_code,
     v_product.name, v_dest, v_product.cost_price, v_product.sell_price, 'PENDING')
  returning * into v_tx;

  insert into public.balance_ledger
    (user_id, type, amount, balance_before, balance_after, transaction_id, note)
  values
    (p_user_id, 'PURCHASE', -v_product.sell_price, v_profile.saldo, v_new, v_tx.id,
     'Pembelian ' || v_product.name || ' ke ' || v_dest);

  perform set_config('app.balance_rpc', 'off', true);

  return query select 'CREATED', v_tx.id, v_tx.reff_id, v_tx.status, v_tx.sell_price, v_new;
end $$;

-- 2) Internal finalize (state machine) ----------------------------------
create or replace function public._finalize_transaction(
  p_reff_id text,
  p_target  text,          -- 'SUCCESS' | 'FAILED'
  p_message text,
  p_raw     jsonb
)
returns table (
  out_outcome text,        -- APPLIED | ALREADY_APPLIED | CONFLICT | NOT_FOUND
  out_tx_id   uuid,
  out_status  text
)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_tx      public.transactions%rowtype;
  v_profile public.profiles%rowtype;
  v_new     bigint;
begin
  if p_target not in ('SUCCESS', 'FAILED') then
    raise exception 'invalid target %', p_target using errcode = '22023';
  end if;

  -- Row lock: concurrent / duplicate callbacks queue here and then see the final state.
  select * into v_tx from public.transactions t where t.reff_id = p_reff_id for update;
  if not found then
    return query select 'NOT_FOUND', null::uuid, null::text;
    return;
  end if;

  if v_tx.status = p_target then
    return query select 'ALREADY_APPLIED', v_tx.id, v_tx.status;     -- duplicate: no-op
    return;
  end if;

  if v_tx.status <> 'PENDING' then
    -- Contradicting final signal (e.g. FAILED+refunded, then "success"). Never flip money
    -- automatically; flag for a human.
    update public.transactions
       set needs_review = true,
           review_note  = left(coalesce(review_note || E'\n', '') ||
                          'Late ' || p_target || ' signal while ' || v_tx.status ||
                          coalesce(': ' || p_message, ''), 2000)
     where id = v_tx.id;
    return query select 'CONFLICT', v_tx.id, v_tx.status;
    return;
  end if;

  perform set_config('app.balance_rpc', 'on', true);

  if p_target = 'FAILED' then
    select * into v_profile from public.profiles p where p.id = v_tx.user_id for update;
    v_new := v_profile.saldo + v_tx.sell_price;

    update public.profiles set saldo = v_new where id = v_tx.user_id;

    -- unique (transaction_id, type) makes a second refund impossible even if this code were wrong.
    insert into public.balance_ledger
      (user_id, type, amount, balance_before, balance_after, transaction_id, note)
    values
      (v_tx.user_id, 'REFUND', v_tx.sell_price, v_profile.saldo, v_new, v_tx.id,
       'Refund ' || v_tx.reff_id);
  end if;

  update public.transactions
     set status           = p_target,
         finalized_at     = now(),
         provider_message = coalesce(p_message, provider_message),
         provider_raw     = coalesce(p_raw, provider_raw)
   where id = v_tx.id;

  perform set_config('app.balance_rpc', 'off', true);

  return query select 'APPLIED', v_tx.id, p_target;
end $$;

create or replace function public.finalize_transaction_success(
  p_reff_id text, p_message text default null, p_raw jsonb default null)
returns table (out_outcome text, out_tx_id uuid, out_status text)
language sql security definer set search_path = public, pg_temp as $$
  select * from public._finalize_transaction(p_reff_id, 'SUCCESS', p_message, p_raw);
$$;

create or replace function public.finalize_transaction_failed(
  p_reff_id text, p_message text default null, p_raw jsonb default null)
returns table (out_outcome text, out_tx_id uuid, out_status text)
language sql security definer set search_path = public, pg_temp as $$
  select * from public._finalize_transaction(p_reff_id, 'FAILED', p_message, p_raw);
$$;

-- 3) Provider attempt bookkeeping (no money; same reff_id on every retry) --
create or replace function public.record_provider_attempt(
  p_reff_id text, p_message text default null, p_raw jsonb default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.transactions
     set provider_attempts     = provider_attempts + 1,
         provider_submitted_at = coalesce(provider_submitted_at, now()),
         provider_message      = coalesce(p_message, provider_message),
         provider_raw          = coalesce(p_raw, provider_raw)
   where reff_id = p_reff_id and status = 'PENDING';
end $$;

-- 4) Admin manual top-up --------------------------------------------------
create or replace function public.admin_manual_topup(
  p_admin_id        uuid,
  p_user_id         uuid,
  p_amount          bigint,
  p_idempotency_key text,
  p_note            text default null
)
returns table (
  out_outcome       text,   -- APPLIED | ALREADY_APPLIED | USER_NOT_FOUND
  out_ledger_id     bigint,
  out_balance_after bigint
)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_admin   public.profiles%rowtype;
  v_profile public.profiles%rowtype;
  v_led     public.balance_ledger%rowtype;
  v_new     bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  -- Defence in depth: the app layer checks admin too, but the database refuses non-admins.
  select * into v_admin from public.profiles p where p.id = p_admin_id;
  if not found or v_admin.role <> 'admin' or not v_admin.is_active then
    raise exception 'caller is not an active admin' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles p where p.id = p_user_id for update;
  if not found then
    return query select 'USER_NOT_FOUND', null::bigint, null::bigint;
    return;
  end if;

  select * into v_led from public.balance_ledger l
   where l.type = 'MANUAL_TOPUP' and l.idempotency_key = p_idempotency_key;
  if found then
    if v_led.user_id <> p_user_id then
      raise exception 'idempotency key already used for another user' using errcode = '22023';
    end if;
    return query select 'ALREADY_APPLIED', v_led.id, v_led.balance_after;
    return;
  end if;

  perform set_config('app.balance_rpc', 'on', true);

  v_new := v_profile.saldo + p_amount;
  update public.profiles set saldo = v_new where id = p_user_id;

  insert into public.balance_ledger
    (user_id, type, amount, balance_before, balance_after, idempotency_key, note, created_by)
  values
    (p_user_id, 'MANUAL_TOPUP', p_amount, v_profile.saldo, v_new, p_idempotency_key, p_note, p_admin_id)
  returning * into v_led;

  perform set_config('app.balance_rpc', 'off', true);

  return query select 'APPLIED', v_led.id, v_new;
end $$;

-- 5) Webhook audit log ------------------------------------------------------
create or replace function public.log_webhook_event(
  p_provider text, p_dedupe_key text, p_reff_id text, p_payload jsonb)
returns table (out_event_id bigint, out_receive_count integer)
language sql security definer set search_path = public, pg_temp as $$
  insert into public.provider_webhook_events (provider, dedupe_key, reff_id, payload)
  values (p_provider, p_dedupe_key, p_reff_id, p_payload)
  on conflict (provider, dedupe_key) do update
    set receive_count = provider_webhook_events.receive_count + 1,
        last_received_at = now()
  returning id, receive_count;
$$;

create or replace function public.set_webhook_event_outcome(p_event_id bigint, p_outcome text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.provider_webhook_events set outcome = p_outcome where id = p_event_id;
$$;

-- 6) Integrity check: saldo must equal the sum of its ledger ----------------
create or replace function public.find_balance_mismatches()
returns table (out_user_id uuid, out_saldo bigint, out_ledger_sum bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.saldo, coalesce(sum(l.amount), 0)::bigint
    from public.profiles p
    left join public.balance_ledger l on l.user_id = p.id
   group by p.id, p.saldo
  having p.saldo <> coalesce(sum(l.amount), 0);
$$;

-- =====================================================================
-- RLS + grants
-- Browser clients (anon / authenticated) can only READ their own rows,
-- column-limited. All writes go through service_role + RPCs.
-- =====================================================================
alter table public.profiles                enable row level security;
alter table public.products_cache          enable row level security;
alter table public.transactions            enable row level security;
alter table public.balance_ledger          enable row level security;
alter table public.provider_webhook_events enable row level security;

revoke all on public.profiles, public.products_cache, public.transactions,
              public.balance_ledger, public.provider_webhook_events
  from public, anon, authenticated;

-- profiles: read own; update ONLY full_name on own row (saldo/role/is_active are not grantable).
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
grant select (id, email, full_name, role, saldo, is_active, created_at) on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- products_cache: active products only, never cost_price / margin / raw.
create policy products_select_active on public.products_cache
  for select to authenticated using (is_active);
grant select (id, provider_code, name, category, sell_price, is_available, synced_at)
  on public.products_cache to authenticated;

-- transactions: own rows, no cost_price / provider_raw / review fields.
create policy transactions_select_own on public.transactions
  for select to authenticated using (user_id = (select auth.uid()));
grant select (id, reff_id, product_name, destination, sell_price, status,
              provider_message, created_at, updated_at, finalized_at)
  on public.transactions to authenticated;

-- balance_ledger: own rows only.
create policy ledger_select_own on public.balance_ledger
  for select to authenticated using (user_id = (select auth.uid()));
grant select (id, type, amount, balance_before, balance_after, transaction_id, note, created_at)
  on public.balance_ledger to authenticated;

-- service_role (server only): table access + RPCs.
grant select, insert, update on public.profiles, public.products_cache, public.transactions to service_role;
grant select on public.balance_ledger to service_role;
grant select, insert, update on public.provider_webhook_events to service_role;

revoke all on function
  public.reserve_balance_and_create_transaction(uuid, uuid, text, text),
  public._finalize_transaction(text, text, text, jsonb),
  public.finalize_transaction_success(text, text, jsonb),
  public.finalize_transaction_failed(text, text, jsonb),
  public.record_provider_attempt(text, text, jsonb),
  public.admin_manual_topup(uuid, uuid, bigint, text, text),
  public.log_webhook_event(text, text, text, jsonb),
  public.set_webhook_event_outcome(bigint, text),
  public.find_balance_mismatches()
  from public, anon, authenticated;

grant execute on function
  public.reserve_balance_and_create_transaction(uuid, uuid, text, text),
  public.finalize_transaction_success(text, text, jsonb),
  public.finalize_transaction_failed(text, text, jsonb),
  public.record_provider_attempt(text, text, jsonb),
  public.admin_manual_topup(uuid, uuid, bigint, text, text),
  public.log_webhook_event(text, text, text, jsonb),
  public.set_webhook_event_outcome(bigint, text),
  public.find_balance_mismatches()
  to service_role;

-- ===== 0002_stage2a.sql =====
-- =====================================================================
-- Toko Kuota — 0002_stage2a
--  1. users can no longer read reff_id (provider correlation id stays server-side)
--  2. reserve_balance_and_create_transaction gains an optional expected-price guard
--  3. sync_products: catalogue upsert that never touches margin / is_active
-- =====================================================================

-- 1) reff_id is the key a provider callback is matched on. There is no webhook
--    signature, so users must not be able to read it from their own history.
revoke select (reff_id) on public.transactions from authenticated;

-- 2) Reserve with an optional price guard -------------------------------------
-- p_expected_price is the price the user SAW. It is never used as the price:
-- the amount charged is always products_cache.sell_price. If the two differ
-- (catalogue cache is up to minutes old) nothing is debited and PRICE_CHANGED
-- is returned with the current price in out_amount.
drop function public.reserve_balance_and_create_transaction(uuid, uuid, text, text);

create or replace function public.reserve_balance_and_create_transaction(
  p_user_id         uuid,
  p_product_id      uuid,
  p_destination     text,
  p_idempotency_key text,
  p_expected_price  bigint default null
)
returns table (
  out_outcome       text,   -- CREATED | EXISTING | USER_NOT_FOUND | USER_INACTIVE | INVALID_DESTINATION
                            -- | PRODUCT_UNAVAILABLE | PRICE_CHANGED | INSUFFICIENT_BALANCE
  out_tx_id         uuid,
  out_reff_id       text,
  out_status        text,
  out_amount        bigint,
  out_balance_after bigint
)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_profile public.profiles%rowtype;
  v_product public.products_cache%rowtype;
  v_tx      public.transactions%rowtype;
  v_dest    text := btrim(coalesce(p_destination, ''));
  v_new     bigint;
  v_reff    text;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles p where p.id = p_user_id for update;
  if not found then
    return query select 'USER_NOT_FOUND', null::uuid, null::text, null::text, null::bigint, null::bigint;
    return;
  end if;

  select * into v_tx from public.transactions t
   where t.user_id = p_user_id and t.idempotency_key = p_idempotency_key;
  if found then
    return query select 'EXISTING', v_tx.id, v_tx.reff_id, v_tx.status, v_tx.sell_price, v_profile.saldo;
    return;
  end if;

  if not v_profile.is_active then
    return query select 'USER_INACTIVE', null::uuid, null::text, null::text, null::bigint, v_profile.saldo;
    return;
  end if;

  if length(v_dest) not between 3 and 64 then
    return query select 'INVALID_DESTINATION', null::uuid, null::text, null::text, null::bigint, v_profile.saldo;
    return;
  end if;

  select * into v_product from public.products_cache pc where pc.id = p_product_id;
  if not found or not v_product.is_active or not v_product.is_available then
    return query select 'PRODUCT_UNAVAILABLE', null::uuid, null::text, null::text, null::bigint, v_profile.saldo;
    return;
  end if;

  if p_expected_price is not null and p_expected_price <> v_product.sell_price then
    return query select 'PRICE_CHANGED', null::uuid, null::text, null::text, v_product.sell_price, v_profile.saldo;
    return;
  end if;

  if v_profile.saldo < v_product.sell_price then
    return query select 'INSUFFICIENT_BALANCE', null::uuid, null::text, null::text, v_product.sell_price, v_profile.saldo;
    return;
  end if;

  perform set_config('app.balance_rpc', 'on', true);

  v_new  := v_profile.saldo - v_product.sell_price;
  v_reff := 'TK' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 18));

  update public.profiles set saldo = v_new where id = p_user_id;

  insert into public.transactions
    (user_id, reff_id, idempotency_key, product_id, provider, provider_code,
     product_name, destination, cost_price, sell_price, status)
  values
    (p_user_id, v_reff, p_idempotency_key, v_product.id, v_product.provider, v_product.provider_code,
     v_product.name, v_dest, v_product.cost_price, v_product.sell_price, 'PENDING')
  returning * into v_tx;

  insert into public.balance_ledger
    (user_id, type, amount, balance_before, balance_after, transaction_id, note)
  values
    (p_user_id, 'PURCHASE', -v_product.sell_price, v_profile.saldo, v_new, v_tx.id,
     'Pembelian ' || v_product.name || ' ke ' || v_dest);

  perform set_config('app.balance_rpc', 'off', true);

  return query select 'CREATED', v_tx.id, v_tx.reff_id, v_tx.status, v_tx.sell_price, v_new;
end $$;

revoke all on function public.reserve_balance_and_create_transaction(uuid, uuid, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.reserve_balance_and_create_transaction(uuid, uuid, text, text, bigint)
  to service_role;

-- 3) Catalogue sync -------------------------------------------------------------
-- Input: jsonb array of {provider_code, name, category, cost_price, is_available, raw}.
-- On conflict only provider-owned columns change; margin and is_active (ours) are kept.
-- New products start INACTIVE with p_default_margin unless p_activate_new is true, so a
-- freshly synced item can never go on sale at cost without a deliberate decision.
create or replace function public.sync_products(
  p_provider       text,
  p_products       jsonb,
  p_default_margin bigint  default 0,
  p_activate_new   boolean default false
)
returns table (out_inserted integer, out_updated integer)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_provider is null or btrim(p_provider) = '' then
    raise exception 'provider required' using errcode = '22023';
  end if;
  if p_products is null or jsonb_typeof(p_products) <> 'array' then
    raise exception 'p_products must be a json array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_products) > 20000 then
    raise exception 'too many products in one sync' using errcode = '22023';
  end if;
  if p_default_margin is null or p_default_margin < 0 then
    raise exception 'invalid default margin' using errcode = '22023';
  end if;

  return query
  with src as (
    select * from jsonb_to_recordset(p_products)
      as x(provider_code text, name text, category text, cost_price bigint, is_available boolean, raw jsonb)
  ),
  up as (
    insert into public.products_cache
      (provider, provider_code, name, category, cost_price, margin, is_active, is_available, raw, synced_at)
    select p_provider, s.provider_code, s.name, s.category, s.cost_price,
           p_default_margin, p_activate_new, coalesce(s.is_available, true), s.raw, now()
      from src s
    on conflict (provider, provider_code) do update
       set name = excluded.name,
           category = excluded.category,
           cost_price = excluded.cost_price,
           is_available = excluded.is_available,
           raw = excluded.raw,
           synced_at = now()
    returning (xmax = 0) as inserted
  )
  select (count(*) filter (where inserted))::integer,
         (count(*) filter (where not inserted))::integer
    from up;
end $$;

revoke all on function public.sync_products(text, jsonb, bigint, boolean) from public, anon, authenticated;
grant execute on function public.sync_products(text, jsonb, bigint, boolean) to service_role;

-- ===== 0003_stage3.sql =====
-- =====================================================================
-- Toko Kuota — 0003_stage3
--  1. products_cache: app-owned display metadata (never touched by provider sync)
--  2. app_settings, admin_audit_log
--  3. claim_provider_send: atomic compare-and-set so /trx is sent AT MOST ONCE per transaction
--  4. maintenance mode enforced inside the reserve RPC; manual top-up writes an audit row
--  5. admin RPCs (every one re-checks the caller is an active admin and writes the audit log)
--  6. admin read RPCs (parameterised search, no string-built filters)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Display metadata owned by the application
-- ---------------------------------------------------------------------
alter table public.products_cache
  add column display_name     text check (display_name is null or length(display_name) between 1 and 200),
  add column display_category text check (display_category is null or length(display_category) between 1 and 100),
  add column sort_order       integer not null default 0 check (sort_order between -100000 and 100000),
  add column description      text check (description is null or length(description) <= 1000);

-- (sync_products from 0002 only writes provider-owned columns, so these, margin and is_active
--  survive every sync.)

-- ---------------------------------------------------------------------
-- 2) Settings + audit
-- ---------------------------------------------------------------------
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.app_settings (key, value) values
  ('maintenance_mode',       'false'::jsonb),
  ('catalog_default_margin', '0'::jsonb),
  ('catalog_activate_new',   'false'::jsonb),
  ('support_contact',        '""'::jsonb),
  ('announcement',           '""'::jsonb)
on conflict (key) do nothing;

create table public.admin_audit_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc, id desc);

create or replace function public.admin_audit_log_guard()
returns trigger language plpgsql as $$
begin
  raise exception 'admin_audit_log is append-only' using errcode = '42501';
end $$;

create trigger admin_audit_log_guard_trg
  before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_guard();

alter table public.app_settings   enable row level security;
alter table public.admin_audit_log enable row level security;
revoke all on public.app_settings, public.admin_audit_log from public, anon, authenticated;
grant select on public.app_settings, public.admin_audit_log to service_role;

-- indexes for the admin lists
create index transactions_created_idx          on public.transactions (created_at desc, id desc);
create index balance_ledger_created_idx        on public.balance_ledger (created_at desc, id desc);
create index balance_ledger_type_created_idx   on public.balance_ledger (type, created_at desc);
create index profiles_created_idx              on public.profiles (created_at desc, id);
create index provider_webhook_events_last_idx  on public.provider_webhook_events (last_received_at desc);

-- ---------------------------------------------------------------------
-- Internal helpers (not callable through the API)
-- ---------------------------------------------------------------------
create or replace function public._require_admin(p_admin_id uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_admin_id is null or not exists (
    select 1 from public.profiles p where p.id = p_admin_id and p.role = 'admin' and p.is_active
  ) then
    raise exception 'caller is not an active admin' using errcode = '42501';
  end if;
end $$;

create or replace function public._audit(p_admin uuid, p_action text, p_type text, p_target text, p_details jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, details)
  values (p_admin, p_action, p_type, p_target, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function public._like(p text)
returns text language sql immutable as $$
  select '%' || replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

revoke all on function public._require_admin(uuid), public._audit(uuid, text, text, text, jsonb), public._like(text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) Atomic claim to send /trx
-- ---------------------------------------------------------------------
-- The ONLY way a transaction may be sent to the provider. One UPDATE both checks and sets
-- provider_attempts, so it is a compare-and-set executed under the row lock: when two requests
-- race, the second waits for the first, re-evaluates `provider_attempts = 0`, matches nothing,
-- and gets out_claimed = false. Whoever gets true sends /trx; everyone else must not.
create or replace function public.claim_provider_send(p_reff_id text)
returns table (
  out_claimed  boolean,
  out_tx_id    uuid,
  out_reff_id  text,
  out_status   text,
  out_attempts integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_tx public.transactions%rowtype;
begin
  update public.transactions t
     set provider_attempts     = t.provider_attempts + 1,
         provider_submitted_at = now()
   where t.reff_id = p_reff_id
     and t.status = 'PENDING'
     and t.provider_attempts = 0
  returning * into v_tx;

  if found then
    return query select true, v_tx.id, v_tx.reff_id, v_tx.status, v_tx.provider_attempts;
    return;
  end if;

  select * into v_tx from public.transactions t where t.reff_id = p_reff_id;
  if found then
    return query select false, v_tx.id, v_tx.reff_id, v_tx.status, v_tx.provider_attempts;
  else
    return query select false, null::uuid, null::text, null::text, null::integer;
  end if;
end $$;

-- record_provider_attempt (0001) incremented without comparing; nothing may use it any more.
drop function public.record_provider_attempt(text, text, jsonb);

-- ---------------------------------------------------------------------
-- 4a) Reserve: maintenance mode (same signature as 0002; repeats still return EXISTING)
-- ---------------------------------------------------------------------
create or replace function public.reserve_balance_and_create_transaction(
  p_user_id         uuid,
  p_product_id      uuid,
  p_destination     text,
  p_idempotency_key text,
  p_expected_price  bigint default null
)
returns table (
  out_outcome       text,   -- CREATED | EXISTING | USER_NOT_FOUND | USER_INACTIVE | MAINTENANCE
                            -- | INVALID_DESTINATION | PRODUCT_UNAVAILABLE | PRICE_CHANGED | INSUFFICIENT_BALANCE
  out_tx_id         uuid,
  out_reff_id       text,
  out_status        text,
  out_amount        bigint,
  out_balance_after bigint
)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_profile public.profiles%rowtype;
  v_product public.products_cache%rowtype;
  v_tx      public.transactions%rowtype;
  v_dest    text := btrim(coalesce(p_destination, ''));
  v_new     bigint;
  v_reff    text;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles p where p.id = p_user_id for update;
  if not found then
    return query select 'USER_NOT_FOUND', null::uuid, null::text, null::text, null::bigint, null::bigint;
    return;
  end if;

  select * into v_tx from public.transactions t
   where t.user_id = p_user_id and t.idempotency_key = p_idempotency_key;
  if found then
    return query select 'EXISTING', v_tx.id, v_tx.reff_id, v_tx.status, v_tx.sell_price, v_profile.saldo;
    return;
  end if;

  if not v_profile.is_active then
    return query select 'USER_INACTIVE', null::uuid, null::text, null::text, null::bigint, v_profile.saldo;
    return;
  end if;

  if coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'maintenance_mode'), false) then
    return query select 'MAINTENANCE', null::uuid, null::text, null::text, null::bigint, v_profile.saldo;
    return;
  end if;

  if length(v_dest) not between 3 and 64 then
    return query select 'INVALID_DESTINATION', null::uuid, null::text, null::text, null::bigint, v_profile.saldo;
    return;
  end if;

  select * into v_product from public.products_cache pc where pc.id = p_product_id;
  if not found or not v_product.is_active or not v_product.is_available then
    return query select 'PRODUCT_UNAVAILABLE', null::uuid, null::text, null::text, null::bigint, v_profile.saldo;
    return;
  end if;

  if p_expected_price is not null and p_expected_price <> v_product.sell_price then
    return query select 'PRICE_CHANGED', null::uuid, null::text, null::text, v_product.sell_price, v_profile.saldo;
    return;
  end if;

  if v_profile.saldo < v_product.sell_price then
    return query select 'INSUFFICIENT_BALANCE', null::uuid, null::text, null::text, v_product.sell_price, v_profile.saldo;
    return;
  end if;

  perform set_config('app.balance_rpc', 'on', true);

  v_new  := v_profile.saldo - v_product.sell_price;
  v_reff := 'TK' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 18));

  update public.profiles set saldo = v_new where id = p_user_id;

  insert into public.transactions
    (user_id, reff_id, idempotency_key, product_id, provider, provider_code,
     product_name, destination, cost_price, sell_price, status)
  values
    (p_user_id, v_reff, p_idempotency_key, v_product.id, v_product.provider, v_product.provider_code,
     coalesce(v_product.display_name, v_product.name), v_dest, v_product.cost_price, v_product.sell_price, 'PENDING')
  returning * into v_tx;

  insert into public.balance_ledger
    (user_id, type, amount, balance_before, balance_after, transaction_id, note)
  values
    (p_user_id, 'PURCHASE', -v_product.sell_price, v_profile.saldo, v_new, v_tx.id,
     'Pembelian ' || coalesce(v_product.display_name, v_product.name) || ' ke ' || v_dest);

  perform set_config('app.balance_rpc', 'off', true);

  return query select 'CREATED', v_tx.id, v_tx.reff_id, v_tx.status, v_tx.sell_price, v_new;
end $$;

-- ---------------------------------------------------------------------
-- 4b) Manual top-up: unchanged behaviour + audit row
-- ---------------------------------------------------------------------
create or replace function public.admin_manual_topup(
  p_admin_id        uuid,
  p_user_id         uuid,
  p_amount          bigint,
  p_idempotency_key text,
  p_note            text default null
)
returns table (
  out_outcome       text,   -- APPLIED | ALREADY_APPLIED | USER_NOT_FOUND
  out_ledger_id     bigint,
  out_balance_after bigint
)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_admin   public.profiles%rowtype;
  v_profile public.profiles%rowtype;
  v_led     public.balance_ledger%rowtype;
  v_new     bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if p_amount > 1000000000 then
    raise exception 'amount too large' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  select * into v_admin from public.profiles p where p.id = p_admin_id;
  if not found or v_admin.role <> 'admin' or not v_admin.is_active then
    raise exception 'caller is not an active admin' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles p where p.id = p_user_id for update;
  if not found then
    return query select 'USER_NOT_FOUND', null::bigint, null::bigint;
    return;
  end if;

  select * into v_led from public.balance_ledger l
   where l.type = 'MANUAL_TOPUP' and l.idempotency_key = p_idempotency_key;
  if found then
    if v_led.user_id <> p_user_id then
      raise exception 'idempotency key already used for another user' using errcode = '22023';
    end if;
    return query select 'ALREADY_APPLIED', v_led.id, v_led.balance_after;
    return;
  end if;

  perform set_config('app.balance_rpc', 'on', true);

  v_new := v_profile.saldo + p_amount;
  update public.profiles set saldo = v_new where id = p_user_id;

  insert into public.balance_ledger
    (user_id, type, amount, balance_before, balance_after, idempotency_key, note, created_by)
  values
    (p_user_id, 'MANUAL_TOPUP', p_amount, v_profile.saldo, v_new, p_idempotency_key, p_note, p_admin_id)
  returning * into v_led;

  perform set_config('app.balance_rpc', 'off', true);

  perform public._audit(p_admin_id, 'manual_topup', 'user', p_user_id::text,
    jsonb_build_object('amount', p_amount, 'ledger_id', v_led.id, 'note', p_note));

  return query select 'APPLIED', v_led.id, v_new;
end $$;

-- ---------------------------------------------------------------------
-- 5) Admin mutations
-- ---------------------------------------------------------------------

-- Product: margin, is_active, display metadata. Patch semantics: only keys present are changed.
create or replace function public.admin_update_product(p_admin_id uuid, p_product_id uuid, p_changes jsonb)
returns table (out_outcome text, out_sell_price bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_old public.products_cache%rowtype;
  v_new public.products_cache%rowtype;
  v_key text;
begin
  perform public._require_admin(p_admin_id);
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'no changes given' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('margin', 'is_active', 'display_name', 'display_category', 'sort_order', 'description') then
      raise exception 'field % cannot be changed', v_key using errcode = '22023';
    end if;
  end loop;

  select * into v_old from public.products_cache pc where pc.id = p_product_id for update;
  if not found then
    return query select 'NOT_FOUND', null::bigint;
    return;
  end if;

  update public.products_cache pc set
    margin           = case when p_changes ? 'margin'           then (p_changes ->> 'margin')::bigint else pc.margin end,
    is_active        = case when p_changes ? 'is_active'        then (p_changes ->> 'is_active')::boolean else pc.is_active end,
    display_name     = case when p_changes ? 'display_name'     then nullif(btrim(p_changes ->> 'display_name'), '') else pc.display_name end,
    display_category = case when p_changes ? 'display_category' then nullif(btrim(p_changes ->> 'display_category'), '') else pc.display_category end,
    sort_order       = case when p_changes ? 'sort_order'       then (p_changes ->> 'sort_order')::integer else pc.sort_order end,
    description      = case when p_changes ? 'description'      then nullif(btrim(p_changes ->> 'description'), '') else pc.description end
  where pc.id = p_product_id
  returning * into v_new;

  perform public._audit(p_admin_id, 'update_product', 'product', p_product_id::text, jsonb_build_object(
    'provider_code', v_old.provider_code,
    'before', jsonb_build_object('margin', v_old.margin, 'is_active', v_old.is_active, 'display_name', v_old.display_name,
                                 'display_category', v_old.display_category, 'sort_order', v_old.sort_order),
    'changes', p_changes));

  return query select 'UPDATED', v_new.sell_price;
end $$;

-- Bulk margin: FLAT (rupiah) or PERCENT (of cost, rounded up). Optional category / active-only scope.
-- Rows whose resulting sell price would be 0 are skipped instead of failing the whole batch.
create or replace function public.admin_bulk_set_margin(
  p_admin_id    uuid,
  p_mode        text,
  p_value       bigint,
  p_category    text    default null,
  p_only_active boolean default false
)
returns table (out_updated integer)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_count integer;
begin
  perform public._require_admin(p_admin_id);
  if p_mode not in ('FLAT', 'PERCENT') then
    raise exception 'mode must be FLAT or PERCENT' using errcode = '22023';
  end if;
  if p_value is null or p_value < 0 or (p_mode = 'FLAT' and p_value > 1000000000) or (p_mode = 'PERCENT' and p_value > 1000) then
    raise exception 'invalid margin value' using errcode = '22023';
  end if;

  with target as (
    select pc.id,
           case when p_mode = 'FLAT' then p_value
                else ceil(pc.cost_price * p_value / 100.0)::bigint end as new_margin
      from public.products_cache pc
     where (p_category is null or coalesce(pc.display_category, pc.category) = p_category)
       and (not p_only_active or pc.is_active)
  )
  update public.products_cache pc
     set margin = t.new_margin
    from target t
   where pc.id = t.id and pc.cost_price + t.new_margin > 0;
  get diagnostics v_count = row_count;

  perform public._audit(p_admin_id, 'bulk_set_margin', 'product', null, jsonb_build_object(
    'mode', p_mode, 'value', p_value, 'category', p_category, 'only_active', p_only_active, 'updated', v_count));

  return query select v_count;
end $$;

-- User flags (is_active, role). An admin cannot change their own flags; changes are serialised so
-- two admins cannot demote each other at the same time and leave the system with no admin.
create or replace function public.admin_set_user_flags(p_admin_id uuid, p_user_id uuid, p_changes jsonb)
returns table (out_outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_target public.profiles%rowtype;
  v_key    text;
  v_active boolean;
  v_role   text;
begin
  perform pg_advisory_xact_lock(hashtext('toko_kuota_admin_flags'));
  perform public._require_admin(p_admin_id);

  if p_admin_id = p_user_id then
    raise exception 'admins cannot change their own account flags' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'no changes given' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('is_active', 'role') then
      raise exception 'field % cannot be changed', v_key using errcode = '22023';
    end if;
  end loop;

  select * into v_target from public.profiles p where p.id = p_user_id for update;
  if not found then
    return query select 'NOT_FOUND';
    return;
  end if;

  v_active := case when p_changes ? 'is_active' then (p_changes ->> 'is_active')::boolean else v_target.is_active end;
  v_role   := case when p_changes ? 'role'      then (p_changes ->> 'role')              else v_target.role end;
  if v_role not in ('user', 'admin') then
    raise exception 'invalid role' using errcode = '22023';
  end if;

  update public.profiles set is_active = v_active, role = v_role where id = p_user_id;

  perform public._audit(p_admin_id, 'set_user_flags', 'user', p_user_id::text, jsonb_build_object(
    'before', jsonb_build_object('is_active', v_target.is_active, 'role', v_target.role),
    'after',  jsonb_build_object('is_active', v_active, 'role', v_role)));

  return query select 'UPDATED';
end $$;

-- Review queue: acknowledge a flagged transaction (note required). Never moves money or status.
create or replace function public.admin_resolve_review(p_admin_id uuid, p_reff_id text, p_note text)
returns table (out_outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_tx public.transactions%rowtype;
begin
  perform public._require_admin(p_admin_id);
  if p_note is null or length(btrim(p_note)) < 3 or length(p_note) > 500 then
    raise exception 'a note of 3-500 characters is required' using errcode = '22023';
  end if;

  select * into v_tx from public.transactions t where t.reff_id = p_reff_id for update;
  if not found then
    return query select 'NOT_FOUND';
    return;
  end if;
  if not v_tx.needs_review then
    return query select 'NOT_FLAGGED';
    return;
  end if;

  update public.transactions
     set needs_review = false,
         review_note  = left(coalesce(review_note || E'\n', '') || '[resolved] ' || btrim(p_note), 2000)
   where id = v_tx.id;

  perform public._audit(p_admin_id, 'resolve_review', 'transaction', v_tx.id::text,
    jsonb_build_object('reff_id', v_tx.reff_id, 'note', btrim(p_note)));

  return query select 'RESOLVED';
end $$;

-- Settings: whitelisted keys, typed values.
create or replace function public.admin_update_settings(p_admin_id uuid, p_changes jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text;
  v_val jsonb;
begin
  perform public._require_admin(p_admin_id);
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'no changes given' using errcode = '22023';
  end if;

  for v_key, v_val in select * from jsonb_each(p_changes) loop
    if v_key in ('maintenance_mode', 'catalog_activate_new') then
      if jsonb_typeof(v_val) <> 'boolean' then raise exception '% must be boolean', v_key using errcode = '22023'; end if;
    elsif v_key = 'catalog_default_margin' then
      if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)
         or (v_val #>> '{}')::numeric < 0 or (v_val #>> '{}')::numeric > 1000000000 then
        raise exception 'catalog_default_margin must be an integer >= 0' using errcode = '22023';
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

  perform public._audit(p_admin_id, 'update_settings', 'settings', null, p_changes);
end $$;

-- ---------------------------------------------------------------------
-- 6) Admin reads (service_role only). All filters are bound parameters; the search text is
--    LIKE-escaped, so '%' or '_' typed by an admin match literally.
-- ---------------------------------------------------------------------
create or replace function public.admin_list_users(
  p_search text default null, p_role text default null, p_active boolean default null,
  p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, email text, full_name text, role text, saldo bigint, is_active boolean, created_at timestamptz)
language sql stable as $$
  select p.id, p.email, p.full_name, p.role, p.saldo, p.is_active, p.created_at
    from public.profiles p
   where (coalesce(p_search, '') = '' or p.email ilike public._like(p_search) or p.full_name ilike public._like(p_search))
     and (p_role is null or p.role = p_role)
     and (p_active is null or p.is_active = p_active)
   order by p.created_at desc, p.id
   limit least(greatest(p_limit, 1), 101) offset greatest(p_offset, 0);
$$;

create or replace function public.admin_list_transactions(
  p_status text default null, p_needs_review boolean default null, p_unsent boolean default null,
  p_stale boolean default null, p_user_id uuid default null, p_search text default null,
  p_limit integer default 25, p_offset integer default 0)
returns table (
  id uuid, reff_id text, user_id uuid, user_email text, product_name text, destination text,
  cost_price bigint, sell_price bigint, status text, provider_attempts integer, needs_review boolean,
  created_at timestamptz, finalized_at timestamptz, last_reconciled_at timestamptz)
language sql stable as $$
  select t.id, t.reff_id, t.user_id, u.email, t.product_name, t.destination, t.cost_price, t.sell_price,
         t.status, t.provider_attempts, t.needs_review, t.created_at, t.finalized_at, t.last_reconciled_at
    from public.transactions t
    join public.profiles u on u.id = t.user_id
   where (p_status is null or t.status = p_status)
     and (p_needs_review is not true or t.needs_review)
     -- reserved but never handed to the provider
     and (p_unsent is not true or (t.status = 'PENDING' and t.provider_attempts = 0 and t.created_at < now() - interval '2 minutes'))
     -- handed to the provider, still no final answer after 10 minutes
     and (p_stale is not true or (t.status = 'PENDING' and t.provider_attempts > 0 and t.created_at < now() - interval '10 minutes'))
     and (p_user_id is null or t.user_id = p_user_id)
     and (coalesce(p_search, '') = '' or t.destination ilike public._like(p_search) or t.product_name ilike public._like(p_search)
          or t.reff_id ilike public._like(p_search) or u.email ilike public._like(p_search))
   order by t.created_at desc, t.id
   limit least(greatest(p_limit, 1), 101) offset greatest(p_offset, 0);
$$;

create or replace function public.admin_list_ledger(
  p_type text default null, p_user_id uuid default null, p_search text default null,
  p_limit integer default 25, p_offset integer default 0)
returns table (
  id bigint, user_id uuid, user_email text, type text, amount bigint, balance_before bigint, balance_after bigint,
  transaction_id uuid, note text, created_by_email text, created_at timestamptz)
language sql stable as $$
  select l.id, l.user_id, u.email, l.type, l.amount, l.balance_before, l.balance_after,
         l.transaction_id, l.note, a.email, l.created_at
    from public.balance_ledger l
    join public.profiles u on u.id = l.user_id
    left join public.profiles a on a.id = l.created_by
   where (p_type is null or l.type = p_type)
     and (p_user_id is null or l.user_id = p_user_id)
     and (coalesce(p_search, '') = '' or u.email ilike public._like(p_search) or l.note ilike public._like(p_search))
   order by l.created_at desc, l.id desc
   limit least(greatest(p_limit, 1), 101) offset greatest(p_offset, 0);
$$;

create or replace function public.admin_list_products(
  p_search text default null, p_category text default null, p_active boolean default null,
  p_limit integer default 25, p_offset integer default 0)
returns table (
  id uuid, provider_code text, name text, display_name text, category text, display_category text,
  cost_price bigint, margin bigint, sell_price bigint, is_active boolean, is_available boolean,
  sort_order integer, synced_at timestamptz)
language sql stable as $$
  select pc.id, pc.provider_code, pc.name, pc.display_name, pc.category, pc.display_category,
         pc.cost_price, pc.margin, pc.sell_price, pc.is_active, pc.is_available, pc.sort_order, pc.synced_at
    from public.products_cache pc
   where (coalesce(p_search, '') = '' or pc.name ilike public._like(p_search) or pc.display_name ilike public._like(p_search)
          or pc.provider_code ilike public._like(p_search))
     and (p_category is null or coalesce(pc.display_category, pc.category) = p_category)
     and (p_active is null or pc.is_active = p_active)
   order by pc.sort_order, coalesce(pc.display_name, pc.name), pc.id
   limit least(greatest(p_limit, 1), 101) offset greatest(p_offset, 0);
$$;

create or replace function public.admin_list_webhook_events(
  p_unresolved boolean default null, p_limit integer default 25, p_offset integer default 0)
returns table (
  id bigint, provider text, reff_id text, outcome text, receive_count integer,
  first_received_at timestamptz, last_received_at timestamptz, message text)
language sql stable as $$
  select e.id, e.provider, e.reff_id, e.outcome, e.receive_count, e.first_received_at, e.last_received_at,
         left(coalesce(e.payload -> 'query' ->> 'message', e.payload ->> 'body', ''), 500)
    from public.provider_webhook_events e
   where (p_unresolved is not true or e.outcome is distinct from 'APPLIED' and e.outcome is distinct from 'ALREADY_APPLIED')
   order by e.last_received_at desc, e.id desc
   limit least(greatest(p_limit, 1), 101) offset greatest(p_offset, 0);
$$;

create or replace function public.admin_list_audit(p_limit integer default 25, p_offset integer default 0)
returns table (id bigint, admin_email text, action text, target_type text, target_id text, details jsonb, created_at timestamptz)
language sql stable as $$
  select a.id, p.email, a.action, a.target_type, a.target_id, a.details, a.created_at
    from public.admin_audit_log a
    left join public.profiles p on p.id = a.admin_id
   order by a.created_at desc, a.id desc
   limit least(greatest(p_limit, 1), 101) offset greatest(p_offset, 0);
$$;

-- One round trip for the dashboard. The (expensive) saldo-vs-ledger check is NOT here:
-- it scans the whole ledger, so it runs on demand via find_balance_mismatches().
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
                                  and outcome is distinct from 'APPLIED' and outcome is distinct from 'ALREADY_APPLIED')
  );
$$;

-- ---------------------------------------------------------------------
-- Grants: everything above is service_role only
-- ---------------------------------------------------------------------
revoke all on function
  public.claim_provider_send(text),
  public.admin_update_product(uuid, uuid, jsonb),
  public.admin_bulk_set_margin(uuid, text, bigint, text, boolean),
  public.admin_set_user_flags(uuid, uuid, jsonb),
  public.admin_resolve_review(uuid, text, text),
  public.admin_update_settings(uuid, jsonb),
  public.admin_list_users(text, text, boolean, integer, integer),
  public.admin_list_transactions(text, boolean, boolean, boolean, uuid, text, integer, integer),
  public.admin_list_ledger(text, uuid, text, integer, integer),
  public.admin_list_products(text, text, boolean, integer, integer),
  public.admin_list_webhook_events(boolean, integer, integer),
  public.admin_list_audit(integer, integer),
  public.admin_dashboard_stats(timestamptz)
  from public, anon, authenticated;

grant execute on function
  public.claim_provider_send(text),
  public.admin_update_product(uuid, uuid, jsonb),
  public.admin_bulk_set_margin(uuid, text, bigint, text, boolean),
  public.admin_set_user_flags(uuid, uuid, jsonb),
  public.admin_resolve_review(uuid, text, text),
  public.admin_update_settings(uuid, jsonb),
  public.admin_list_users(text, text, boolean, integer, integer),
  public.admin_list_transactions(text, boolean, boolean, boolean, uuid, text, integer, integer),
  public.admin_list_ledger(text, uuid, text, integer, integer),
  public.admin_list_products(text, text, boolean, integer, integer),
  public.admin_list_webhook_events(boolean, integer, integer),
  public.admin_list_audit(integer, integer),
  public.admin_dashboard_stats(timestamptz)
  to service_role;

-- ===== 0004_topup.sql =====
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

-- ===== 0005_hardening.sql =====
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

-- ===== 0006_ops.sql =====
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

-- ===== 0007_invite_codes.sql =====
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

-- ===== 0008_bootstrap_admin.sql =====
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
