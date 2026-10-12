# 02 — Architecture

## Layers
```text
Browser ──(anon key, RLS, read-only own rows)──────────────► Supabase
   │
   └─► Next.js route handlers / server actions (service role, server only)
            │  validate session → call RPC (atomic money) → call provider adapter
            ├─► Supabase RPCs (SECURITY DEFINER, service_role only)
            └─► ProviderAdapter ──► KhfyPay (GET endpoints)
KhfyPay ──► GET /webhook/<secret>?message=… ──► handleWebhookRequest ──► processWebhook() ──► finalize_* RPC
Vercel Cron ──► /api/cron/sync-products (daily) · /api/cron/reconcile (disabled until 2B)
```

## Folder map
```text
src/app/                    Next.js App Router (UI + route handlers)
src/lib/env/server.ts       zod-validated server env (server-only, lazy)
src/lib/supabase/           admin.ts (service role, server-only) · browser.ts (anon)
src/lib/providers/
  types.ts                  ProviderAdapter boundary (business code imports only this)
  index.ts                  provider registry (future multi-provider)
  khfypay/
    wire.ts                 the ONLY place with unconfirmed wire details (TODOs)
    request-builder.ts      builds GET URLs, redacts API key, refuses to guess
    http.ts                 fetch + hard timeout → response | transport_error
    parsers.ts              response parsers (TODO until real JSON samples)
    adapter.ts              KhfyPayAdapter implements ProviderAdapter
    result-codes.ts         0 → SUCCESS, 1 → FAILED, else UNKNOWN
    webhook.ts              message extraction, dedupe key, message parser (TODO)
src/lib/transactions/
  rpc.ts                    typed, zod-checked wrappers around the DB RPCs
  submit-policy.ts          what to do after /trx (timeouts never refund)
  webhook-processor.ts      transport-agnostic webhook handling
supabase/migrations/        0001_core.sql
supabase/tests/             SQL behaviour + concurrency tests (local Postgres)
tests/                      vitest unit tests
```

## Key design decisions
- **Money lives in PostgreSQL.** Node code never computes or writes a balance; it only calls RPCs. Triggers reject any other path to `saldo`, ledger rows, or terminal statuses.
- **Idempotency in the database.** Checkout: `unique(user_id, idempotency_key)`. Final state: row-locked state machine. Refund/purchase: `unique(transaction_id, type)` on the ledger.
- **Lock order:** transaction row → profile row (checkout and top-up lock only the profile), so no deadlock cycles.
- **Provider boundary.** Unknown wire details are isolated (`wire.ts`, `parsers.ts`, `webhook.ts`). Until filled, the system fails safe: it refuses to send guessed requests and leaves unparsed callbacks un-finalized.
- **Cost control.** Catalog is cached in `products_cache` (one provider call per sync, not per page view); browser reads are column-limited; liveness endpoint touches no DB; static pages by default.
- **Conflicts are flagged, not auto-resolved.** A late `SUCCESS` after `FAILED` (or the reverse) sets `needs_review` and moves no money.

## Tahap 2A additions
```text
src/middleware.ts                    routing convenience only (getClaims, local JWT check); pages/actions re-verify with getUser()
src/lib/supabase/server.ts           per-request anon client (RLS) for reads of the user's own data
src/lib/auth/                        requireUser/getProfile (cached per request), schemas, safeNextPath
src/app/(auth)/                      login / register / logout server actions
src/app/(app)/                       dashboard, products, products/[id] (checkout), transactions, transactions/[id]
src/app/api/checkout                 JSON checkout (same-origin check, verified session)
src/app/webhook/[token]              webhook endpoint → lib/webhook/handler.ts
src/lib/transactions/checkout.ts     reserve → record attempt → send once → store raw → STOP (no finalize path)
src/lib/transactions/store.ts        non-money persistence (snapshots, review flags, reconcile bookkeeping)
src/lib/transactions/reconcile.ts    /history lookup by refid; gated by POLICY.RECONCILE_ENABLED=false
src/lib/transactions/policy.ts       financial-processing switches (code constants, 2B hold)
src/lib/catalog/                     normalize (boundary), sync, cache (5 min, one DB read per window), filter
```
- **Reads vs writes:** the browser/user client only reads (RLS, column-limited). Every money or status change is a service-role RPC invoked after the session is verified.
- **Cost control:** landing/health are static; middleware runs only on app pages; the catalogue and product detail come from one cached query shared by all users; history uses limit+1 paging (no count query); the detail page auto-refreshes every 15 s for at most 5 minutes while PENDING.
- **Checkout sequence:** `assertReady` → `reserve` (DB price; idempotency key = one per rendered form) → `claimSend` (atomic compare-and-set) → `/trx` only if the claim was won → store redacted snapshot → redirect to the transaction page.

## Tahap 3 additions
```text
src/app/admin/                     dashboard, monitoring, users(+[id]), transactions(+[id]), products(+[id]), ledger, settings, audit
src/app/admin/actions.ts           every admin mutation: getAdminId() (DB role) → zod → ONE RPC (re-checks admin + audits)
src/lib/admin/                     auth (role from DB), guard, schemas, list-params (filter parsing), queries (read RPCs), rpc (mutation wrappers)
src/lib/settings/                  public settings (cached 60 s), sync options (DB, not env)
src/components/                    ui primitives, Toast, ActionForm, AdminForms, AdminShell/AppShell, NavLinks (+mobile bottom bar), Logo, Skeleton, ErrorPanel
```
- **Admin trust model:** admin-ness is read from `profiles` by the server with the service role after `getUser()`; the layout returns 404 to non-admins; every action re-checks; every RPC re-checks in Postgres. No admin RLS policies exist, so there is nothing to misconfigure.
- **Sending exactly once:** `sendIfClaimed` is the only code that calls `/trx`. Checkout repeats, recovery and the admin "send to provider" button all go through the same atomic claim.
- **No manual finalization:** admins can view, filter, close review flags and send *unsent* transactions. There is intentionally no admin "mark success / refund" (Tahap 2B hold).
- **UI:** mobile-first; user app has a bottom tab bar, admin has a sidebar that collapses to a top block; every page has loading (skeleton), empty and error states; server-action results appear inline (aria-live) and as toasts; forms have labels, hints and `aria-describedby`; `Lompat ke konten` skip link; focus rings; 44px touch targets; `prefers` no external fonts/images (logo is a 256 px static file served `unoptimized`).

## Tahap 4A additions (top-up)
```text
src/app/(app)/topup/, topup/[id]    user: request, instructions (countdown, copy), cancel
src/app/admin/topups, admin/banks   admin: requests + manual confirm, review queue, bank accounts
src/lib/topup/                      rpc (typed wrappers + ingestIncomingTransfer), schemas, messages, banks
src/app/api/cron/expire-topups      daily tidy-up (expiry also happens lazily)
```
Money rules are unchanged: only RPCs move saldo; a transfer is detected somewhere else (4B) and enters through `record_incoming_transfer`. See docs/07.
