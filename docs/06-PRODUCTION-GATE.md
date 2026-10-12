# 06 — Production gate

**The project is NOT production-ready.** Tahap 2B is on HOLD. Everything below must be true first.

| # | Gate | Status |
|---|---|---|
| 1 | Real JSON samples of `/list_product`, `/trx`, `/history` | ❌ missing |
| 2 | Real webhook sample: SUCCESS | ❌ missing |
| 3 | Real webhook sample: FAILED | ❌ missing |
| 4 | Provider parsers + webhook `STATUS_EXTRACTORS` implemented against those fixtures | ❌ blocked by 1–3 |
| 5 | `/history` verification enabled (`verify` hook wired, `POLICY.RECONCILE_ENABLED = true`) | ❌ blocked by 1, 4 |
| 6 | Live/sandbox provider integration test succeeds | ❌ not run |
| 7 | Webhook end-to-end succeeds (provider → /webhook → SUCCESS) | ❌ not run |
| 8 | Refund flow end-to-end succeeds (provider failure → FAILED → single refund) | ❌ not run (DB side tested; provider side not) |
| 9 | Recovery-send concurrency test PASS | ✅ passes against real PostgreSQL; mutation-checked (a non-atomic claim makes it fail) |

Also open: provider `reff_id` rules (format/length, duplicate handling), confirmation that the provider keeps the callback URL path/query, expected webhook response body/retry policy, rate limiting on checkout/login (needs infra), a reconcile cron schedule (Vercel Hobby = daily only), and a real Supabase Auth end-to-end run (login/register/e-mail confirmation/admin pages have only been verified by typecheck, build, unit tests and HTTP smoke tests, not against a live Supabase project).

## Additional gate for the top-up feature (before accepting real money)
| # | Gate | Status |
|---|---|---|
| T1 | Mutation/payment service chosen (supports the bank, terms/cost checked by the owner) | ❌ open |
| T2 | Real sample payload of that service's incoming-transfer webhook | ❌ missing |
| T3 | Webhook handler with the service's signature verification → `ingestIncomingTransfer` | ❌ blocked by T1, T2 (Tahap 4B) |
| T4 | End-to-end test with a real small transfer (match, wrong amount, late, duplicate callback) | ❌ not run |
| T5 | Bank account entered by an admin, `topup_enabled` switched on deliberately | ❌ not done (OFF by default) |
| T6 | Legal / bank-terms check for collecting user funds | ❌ owner to check |
| T7 | Atomic credit + concurrency (same transaction, same amount, confirm vs auto) | ✅ passes against real PostgreSQL |

## Audit follow-ups (status)
| Item | Status |
|---|---|
| Security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP) | done; **CSP not yet verified in a real browser**: check the console on staging, `CSP_REPORT_ONLY=1` is the rollback switch |
| Rate limiting (login, register, forgot password, checkout, top-up creation) | done (Postgres-backed, fails open if the limiter errors) |
| Forgot / reset password, friendly message for a failed e-mail link | done in code; **needs custom SMTP** in Supabase before real users sign up |
| Terms / Privacy pages | **draft with placeholders**, needs the owner and legal review |
| CI (typecheck, lint, SQL + concurrency, unit + real-DB tests, build, audit) | workflow written and YAML-validated; **not yet run on GitHub** |
| Trigger-function grants, FK indexes, trigram indexes | done (0005) |
| Still open | staging end-to-end on real Supabase, admin MFA + dual control for large credits, monitoring/alerting + backups (PITR), provider balance monitoring, user notifications, runbook / secret rotation, `supabase gen types`, Next upgrade for the postcss advisory |

## Operations patch (status)
| Item | Status |
|---|---|
| Admin MFA (TOTP, aal2) enforced for the admin area, pages and actions | done in code; **not yet exercised against a real Supabase project** |
| Per-admin daily credit cap | done and tested in Postgres |
| Telegram alerts + daily digest | done (no-op until the bot is configured); needs a real bot to confirm delivery |
| Audited CSV export (formula-injection safe) | done |
| Profile page (name, password with current-password check) | done in code, not yet run against real Auth |
| Runbook, staging checklist | docs/09, docs/10 |
| Still open | staging end-to-end, monitoring beyond Telegram, backups/PITR, provider balance monitoring, dual approval for large credits, KhfyPay 2B items |
