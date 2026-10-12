# 01 — PRD: Toko Kuota (Raja Kuota)

Source of truth: `00-MASTER-README.md`. This file turns it into scoped requirements.

## Product
A digital reseller / top-up website. Users hold a balance (saldo), buy products (kuota, pulsa, etc.) that are fulfilled by the KhfyPay provider, and see their transaction and balance history. Admins manage users, margins and balances.

## Users
- **User (reseller/customer):** registers, logs in, browses the catalog, checks out, views history/status.
- **Admin:** manages users, product margins/visibility, manual top-ups, transactions, ledger.

## Scope by stage
| Stage | Scope |
|---|---|
| 1 Core foundation | Skeleton, DB schema + RLS + grants, atomic balance RPCs, KhfyPay adapter boundary + request builder, webhook parser architecture |
| 2 Core application | Supabase Auth, dashboard, cached catalog, checkout, history, detail/status, `/list_product`, `/trx`, `/history`, `/webhook/<token>`, timeout/reconciliation, idempotent handling |
| 3 Admin + polish | Admin dashboard, users, product/margin, manual top-up, transactions, ledger page, settings, responsive UI, final branding, loading/error/empty states |

## Top-up
Automatic bank-transfer top-up with a unique nominal (Tahap 4, see docs/07). No payment gateway/QRIS. The app side is built; automatic detection of incoming transfers (Tahap 4B) is not. Meanwhile admins can confirm a request by hand or use manual top-up.

## Functional rules
1. Price is computed by the database (`products_cache.sell_price = cost_price + margin`). The client never sends a price.
2. Checkout = one atomic operation: lock user balance → validate → debit → create `PENDING` transaction → ledger row.
3. Final state arrives from the provider webhook or `/history` reconciliation. `FAILED` triggers exactly one atomic refund.
4. A provider timeout is **not** a failure; the transaction stays `PENDING`.
5. Every balance movement has an immutable ledger row; `profiles.saldo` always equals the sum of that user's ledger.
6. Retrying a purchase reuses the same `reff_id` and the same idempotency key.

## Non-functional
Mobile-first, fast, minimal provider calls (cache catalog), minimal Supabase queries/egress, minimal serverless work, secrets only on the server, auditable money trail.

## Brand
Raja Kuota, blue `#2563EB` + purple `#7C3AED`, white surfaces, slate text, subtle gradients. The logo (black-and-white circular crown badge "RAJA KUOTA") lives in `public/logo.png` and `src/app/icon.png`; the site is named Toko Kuota with Raja Kuota as the store name.
