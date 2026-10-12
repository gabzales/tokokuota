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
