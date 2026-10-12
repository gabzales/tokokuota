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
