# 03 — Supabase database, RLS, RPCs

Implemented in `supabase/migrations/0001_core.sql`. All amounts are integer rupiah (`bigint`).

## Tables
| Table | Purpose | Key constraints |
|---|---|---|
| `profiles` | 1:1 with `auth.users`; `saldo`, `role`, `is_active` | `saldo >= 0`; trigger blocks `saldo` change outside RPCs |
| `products_cache` | Provider catalogue + our margin | `unique(provider, provider_code)`; `sell_price` generated = `cost_price + margin` and `> 0`; `raw jsonb` keeps the untouched provider payload |
| `transactions` | One row per purchase | `unique(reff_id)`; `unique(user_id, idempotency_key)`; status ∈ PENDING/SUCCESS/FAILED; `finalized_at` set iff not PENDING; price/user/reff immutable; terminal status immutable; no delete |
| `balance_ledger` | Append-only saldo audit | signed `amount`; `balance_after = balance_before + amount`; `unique(transaction_id, type)` ⇒ one PURCHASE and one REFUND per transaction; update/delete blocked |
| `provider_webhook_events` | Audit log of callbacks | `unique(provider, dedupe_key)`, `receive_count`; not used for idempotency |

Indexes cover: user history (`transactions`, `balance_ledger` by user + time), pending reconciliation (partial index on `PENDING`), review queue (partial on `needs_review`), catalog (`is_active, category`).

## RPCs (SECURITY DEFINER, `search_path` pinned, EXECUTE only for `service_role`)
| RPC | Behaviour |
|---|---|
| `reserve_balance_and_create_transaction(user, product, destination, idempotency_key)` | Locks profile → returns existing tx for a repeated key → validates user/destination/product → price from DB → debit + `PENDING` tx + `PURCHASE` ledger. Outcomes: `CREATED, EXISTING, USER_NOT_FOUND, USER_INACTIVE, INVALID_DESTINATION, PRODUCT_UNAVAILABLE, INSUFFICIENT_BALANCE` |
| `finalize_transaction_success(reff_id, message, raw)` | Locks tx; `PENDING→SUCCESS`; repeat ⇒ `ALREADY_APPLIED`; after FAILED ⇒ `CONFLICT` (flagged) |
| `finalize_transaction_failed(reff_id, message, raw)` | Locks tx then profile; `PENDING→FAILED` + one `REFUND`; repeat ⇒ `ALREADY_APPLIED`; after SUCCESS ⇒ `CONFLICT`, no refund |
| `admin_manual_topup(admin, user, amount, idempotency_key, note)` | DB re-checks the caller is an active admin; amount > 0; idempotent per key; writes `MANUAL_TOPUP` ledger |
| `log_webhook_event` / `set_webhook_event_outcome` | Audit log of callbacks |
| `find_balance_mismatches()` | Returns users whose `saldo` ≠ sum(ledger); should always be empty |

## RLS and grants (browser = read-only, column-limited)
- Everything is revoked from `public, anon, authenticated`, then re-granted narrowly.
- `profiles`: read own row (`id, email, full_name, role, saldo, is_active, created_at`); update **only** `full_name`.
- `products_cache`: read active rows; columns `id, provider_code, name, category, sell_price, is_available, synced_at` (no `cost_price`, `margin`, `raw`).
- `transactions`: read own rows; no `cost_price`, `provider_raw`, review fields.
- `balance_ledger`: read own rows.
- `provider_webhook_events`: RLS on, no client access.
- Admin pages (Tahap 3) read through the server with the service role after an admin check; there are no admin RLS policies to get wrong.

## Operational notes
- The catalog sync (Tahap 2) must upsert without overwriting `margin` or `is_active`.
- `client select *` on column-limited tables fails by design; list the columns.
- Test with `PSQL="psql -U postgres" ./supabase/tests/run.sh` against a scratch Postgres, never your live project.

## Migration 0002 (Tahap 2A)
- `revoke select (reff_id) on transactions from authenticated`: users identify transactions by `id`; the provider correlation id stays server-side.
- `reserve_balance_and_create_transaction(..., p_expected_price bigint default null)`: the price the user saw is only a **guard** against the 5-minute catalogue cache. If it differs from `products_cache.sell_price`, outcome `PRICE_CHANGED` is returned (current price in `out_amount`) and nothing is debited. The amount charged is always the database price.
- `sync_products(provider, products jsonb, default_margin, activate_new)`: upsert by `(provider, provider_code)`; on conflict only `name, category, cost_price, is_available, raw, synced_at` change, so **margin and is_active are never overwritten**. New products start inactive unless `activate_new` is true.
- Tests: `supabase/tests/11_stage2_tests.sql`.

## Migration 0003 (Tahap 3)
- **`claim_provider_send(reff_id)`**: the only way a transaction may be sent to the provider. One `UPDATE ... WHERE status='PENDING' AND provider_attempts = 0` is a compare-and-set under the row lock: of any number of racing callers exactly one gets `out_claimed = true`; the others get `false` plus the same transaction/reff_id. The old `record_provider_attempt` (increment without comparing) is dropped.
- **`products_cache`** gains app-owned `display_name, display_category, sort_order, description`. `sync_products` never writes them, nor `margin` / `is_active` (tested).
- **`app_settings`** (maintenance_mode, catalog_default_margin, catalog_activate_new, support_contact, announcement) and append-only **`admin_audit_log`**; both service_role only.
- **Maintenance mode** is enforced inside `reserve_balance_and_create_transaction` (outcome `MAINTENANCE`); repeats of an existing idempotency key still resolve to `EXISTING`.
- **Admin mutations** (each re-checks the caller is an active admin and writes the audit log with before/after): `admin_update_product` (patch of margin / is_active / display fields only; provider-owned columns are rejected), `admin_bulk_set_margin` (FLAT or PERCENT, optional category / active-only, rows that would end at sell price 0 are skipped), `admin_set_user_flags` (cannot change own account; serialised with an advisory lock so two admins cannot demote each other into zero admins), `admin_resolve_review` (note required; closes the flag only, never changes status or money), `admin_update_settings` (whitelisted, typed), `admin_manual_topup` (now also audited, capped at Rp 1.000.000.000).
- **Admin reads** (service_role only, bound parameters, LIKE-escaped search so `%` and `_` are literal): `admin_list_users / _transactions / _ledger / _products / _webhook_events / _audit`, `admin_dashboard_stats`. The saldo-vs-ledger scan (`find_balance_mismatches`) is deliberately NOT part of the dashboard load; it is a manual button.
- Tests: `supabase/tests/12_stage3_tests.sql`, concurrency E (claim) and F (admin demotion) in `20_concurrency.sh`.

## Migration 0004 (Tahap 4A: top-up)
- `balance_ledger.type` gains `TOPUP` (amount > 0).
- Tables: `topup_banks` (admin-entered account details), `topup_requests` (unique pending nominal per bank), `topup_transfers` (every reported incoming transfer + review queue). RLS on; users can read only their own requests, column-limited; everything else is service_role only.
- RPCs (service_role only): `create_topup_request`, `cancel_topup_request`, `expire_topup_requests`, `record_incoming_transfer`, `admin_confirm_topup_request`, `admin_resolve_transfer`, `admin_upsert_topup_bank`, `admin_list_topups`, `admin_list_transfers`; `admin_update_settings` extended (typed + min<=max checks); `admin_dashboard_stats` gains `topup_pending`, `topup_queued`.
- Tests: `13_topup_tests.sql`; concurrency G (same bank transaction x25), H (different transactions, same amount), I (confirm vs auto-match), J (30 simultaneous requests); `tests/db/topup-rpc.test.ts` runs the TypeScript wrappers against real PostgreSQL. See docs/07.

## Migration 0005 (audit follow-ups)
- Trigger functions (incl. SECURITY DEFINER `handle_new_user`) are no longer executable by PUBLIC/anon/authenticated; Supabase's default grants of new public functions to API roles are removed. PostgreSQL's own PUBLIC default cannot be removed per schema, so every migration must `revoke ... from public` on new functions: `14_hardening_tests.sql` fails if any public function is executable by anon/authenticated.
- Indexes added for every foreign key that lacked one; `pg_trgm` GIN indexes for the admin ILIKE searches.
- `rate_limits` + `rate_limit_hit(key, limit, window_seconds)`: fixed windows counted by one atomic upsert (40 parallel hits with limit 10 => exactly 10 allowed, concurrency K). Keys are hashed by the app. `rate_limit_cleanup()` runs from the daily expire cron.

## Migration 0006 (operations)
- `app_settings.admin_credit_daily_cap` (default Rp 10.000.000, range 1..2.000.000.000): per-admin cap on manual credits in a rolling 24h, enforced inside `admin_manual_topup`, `admin_confirm_topup_request` and `admin_resolve_transfer (CREDIT)`. One advisory lock per admin serialises concurrent credits (concurrency L: 10 parallel credits with a 100k cap => exactly 3 succeed). Automatic credits (real matched transfers) are not counted. A refused credit moves no money (SQLSTATE 54000).
- `admin_export_transactions` / `admin_export_ledger`: audited, max 366 days, first 10.001 rows (the app reports truncation), service_role only.

## Migration 0007 (invite-only registration)
- `invite_codes` (RLS on, no policies, nothing granted to anon/authenticated). Code format `TK-XXXX-XXXX-XXXX` (48 random bits), single use, expires (default 7 days, admin chooses 1..90), revocable.
- `BEFORE INSERT` trigger `enforce_invite_on_signup` on `auth.users` consumes the code from `raw_user_meta_data.invite_code` in ONE atomic UPDATE, in the same transaction as the signup: a signup that fails later does not burn the code, and two signups can never share one. Because it sits on `auth.users`, calling the Supabase Auth API directly (the anon key is public) cannot skip it.
- Consequence: Supabase dashboard "Add user" and any other signup path also need a code. First admin: create a code in the SQL editor (see README).
- `invite_code_valid(code)` (read-only, service_role) is only for a friendly message on /register. `admin_create_invite_code` / `admin_revoke_invite_code` re-check admin and write the audit log (the code itself is never written to the audit log).
- Tests: `supabase/tests/16_invite_tests.sql`. Suites 10..15 and the concurrency script disable the gate (they insert users directly); `run.sh` does that.

## Migration 0008 (first admin from the web)
- `setup_needed()`, `bootstrap_admin_invite()`, `bootstrap_promote_admin(uuid)` (service_role only). The `/setup` page (env `SETUP_SECRET`) mints a 10-minute invite, creates the user through the Auth admin API with that invite (so the 0007 gate still applies), then promotes it.
- Both bootstrap functions take one advisory lock and refuse once any admin exists: parallel setups cannot create two admins; the loser's account is deleted by the app.
- Tests: `supabase/tests/17_bootstrap_tests.sql` (runs in a rolled-back transaction).
