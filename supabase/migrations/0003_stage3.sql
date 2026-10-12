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
