# 04 — KhfyPay integration

## Documented (implemented)
| Item | Implementation |
|---|---|
| `GET /trx` params `produk`, `tujuan`, `reff_id`, `api_key` | `khfypay/wire.ts` + `request-builder.ts` |
| `GET https://panel.khfy-store.com/api_v2/history` params `refid`, `api_key` (lookup of ONE transaction; no date/pagination) | same; `ProviderAdapter.getHistory({ reffId })` |
| `GET /list_product` (`api_key` confirmed) | same |
| `GET /api_v3/cek_stock_akrab` (documentation lists **no** `api_key`, so none is sent) | same (`authenticated.cekStockAkrab = false`) |
| Webhook `GET /webhook?message=<message>` (GET is primary; POST form/JSON only as compatibility) | `app/webhook/[token]` → `lib/webhook/handler.ts` |
| `result=0` success, `result=1` failed/cancelled | `khfypay/result-codes.ts`; anything else = `UNKNOWN` |

## NOT provided (fail closed, never guessed)
| Item | Where isolated | Behaviour until provided |
|---|---|---|
| Real JSON of `/list_product`, `/trx`, `/history` | `khfypay/parsers.ts` (return `null`) | adapter returns `unparsed` + raw; catalogue sync writes nothing; checkout leaves PENDING; reconcile (disabled) would do nothing |
| Layout of webhook `message` — how success/failure is written | `khfypay/webhook.ts` `STATUS_EXTRACTORS` (empty) | the callback is correlated by OUR reff_id and logged; status stays `UNKNOWN`; **nothing is finalized** |
| Webhook signature / secret | none documented, none invented | we add our own secret to the callback URL (below) and rely on correlation + state machine |
| `reff_id` format limits; provider handling of a repeated `/trx` with the same `reff_id` | `reserve_balance_and_create_transaction` makes `TK` + 18 hex | checkout never re-sends automatically |
| Meaning of `result` inside a synchronous `/trx` response | n/a | `/trx` response never finalizes (Tahap 2B hold) |
| What the provider expects as the webhook HTTP response body/status, and its retry policy | `lib/webhook/handler.ts` | 200 `{ok,outcome}` when processed, 500 on our own errors (so it may retry), 401 bad token |

## Webhook authenticity (no provider signature)
Register this callback URL with the provider and keep the secret private:

```text
https://tokokuota.web.id/webhook/<WEBHOOK_SECRET>      (provider appends ?message=<message>)
(a trailing segment such as /<WEBHOOK_SECRET>/webhook is tolerated; the secret must be the first path segment)
```
This is the ONLY webhook URL: `/webhook` and `/api/webhook` were removed and a `?token=` query is rejected (query strings leak into access logs). The token is compared in constant time and removed before anything is logged or stored. This is **our** URL secret, not a KhfyPay feature: confirm the provider keeps the path/query of the URL you register. Without `WEBHOOK_SECRET` the endpoint answers 503.

Validation chain before a callback can change anything: token → message → one of OUR reff_ids → local transaction exists → it was actually sent to the provider (`provider_attempts > 0`) → optional destination corroboration → optional independent verification (`/history`, 2B) → `finalize_*` RPC (row-locked state machine: duplicates are no-ops, contradictions are flagged). Users cannot read `reff_id` (column grant revoked in 0002).

## Safety rules implemented
- Timeout, network error, non-2xx and unrecognised responses on `/trx` ⇒ transaction stays `PENDING`. Checkout has **no** finalize/refund code path.
- `/trx` is sent only after winning the atomic database claim (`claim_provider_send`); recovery, repeated checkout and the admin button can never send twice. Tested against real PostgreSQL (`tests/db`).
- The API key exists only inside the request builder; `redactedUrl` is the only loggable form; stored provider snapshots are redacted and truncated (4 KB).
- Base URL must be `https`; hard timeout `KHFYPAY_TIMEOUT_MS` (default 15 s).
- `assertReady()` proves the request can be built before any balance is touched.

## To finish (Tahap 2B)
1. Save real samples under `tests/fixtures/`: `/list_product`, `/trx`, `/history`, plus one success and one failure webhook `message`.
2. Implement the three parsers and a `STATUS_EXTRACTOR` against those fixtures, with tests.
3. Wire `verify` (history lookup by `refid`) into `processWebhook`, then set `POLICY.RECONCILE_ENABLED = true` and schedule `/api/cron/reconcile`.
