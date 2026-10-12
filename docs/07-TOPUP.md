# 07 — Automatic top-up (Tahap 4A: app side)

Client requirement: user enters an amount, gets a **unique transfer amount**, transfers exactly that to the bank account, and the balance is credited automatically. Decisions confirmed with the client: bank transfer with unique nominal (not a gateway), **BRI first** (1 bank; the model supports several), **saldo credited = amount transferred** (transfer 52.398 → saldo +52.398), **24-hour validity**, fee for the detection service borne by the client, late/mismatched transfers go to a review queue for manual credit.

## Flow
1. `/topup`: user enters amount + bank → `create_topup_request` (price is irrelevant here; nothing touches saldo). The request holds `base_amount + unique_code = total_amount`, valid for `topup_expiry_minutes` (default 1440).
2. `/topup/[id]`: exact nominal, bank, account number, holder, countdown, copy buttons, auto-refresh, cancel.
3. Money arrives → **`record_incoming_transfer(bank_code, amount, bank_ref, occurred_at, raw)`** (provider-neutral; Tahap 4B maps a mutation-service webhook onto it). Exactly one PENDING request with that bank + total amount, not expired *at the time the money arrived*, active user → credited once (`TOPUP` ledger row, request `PAID`).
4. Everything else is **queued** for an admin (`/admin/topups?view=queue`): no matching request, arrived after expiry, user inactive, or same amount as an already-paid request (probably confirmed by hand). Admin credits a chosen user (note required, audited) or ignores it.
5. Interim before 4B: admin checks the bank app and uses **Konfirmasi** on a request (note required, audited). Same credit path, same idempotency.

## Why it cannot double-credit or mismatch
| Guard | Where |
|---|---|
| One PENDING request per (bank, exact total) | partial unique index `topup_requests_pending_nominal` |
| The same bank transaction is processed once | `unique(bank_code, bank_ref)` on `topup_transfers` |
| A request is paid once | status machine under row lock (`PENDING → PAID`, `EXPIRED → PAID` only by admin confirm) + ledger `unique(type, idempotency_key)` with key `req:<id>` / `transfer:<id>` |
| Auto-match racing admin confirm | both lock the request row; the loser sees `PAID` (tested, concurrency I) |
| A user hoarding nominals | max 3 pending per user; expired requests release their nominal lazily |
| Account switched mid-payment | bank number/holder cannot change while unexpired PENDING requests exist |
| Saldo / ledger / status changed outside the RPCs | guard triggers (same mechanism as purchases) |
| Users reading other users' data | RLS own rows + column grants; bank account details served by the server only for the user's own request |

## Settings (Admin > Pengaturan)
`topup_enabled` (**OFF by default**), `topup_min_amount` (10.000), `topup_max_amount` (2.000.000), `topup_code_min/max` (1–999), `topup_expiry_minutes` (1440). These defaults are proposals, not client decisions; change them freely. The bank account (number, holder) is entered in **Admin > Rekening Top-up**; it is not in the code or the repo.

## Tahap 4B (not built, waiting for decisions/samples)
- Choice of the mutation/payment service (cost, bank support incl. BRI, terms) and an account created by the account owner. Bank credentials go only into that service by the owner, never into this system.
- The webhook handler: authenticate (the service's signature), parse a REAL sample payload into `IncomingTransfer`, call `ingestIncomingTransfer`. No format is guessed. Until then the credit path is admin confirmation.
- Also open: legal/bank-terms check for collecting user funds in a personal account; reconciliation report (bank statement vs ledger).
