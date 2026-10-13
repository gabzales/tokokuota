# AI-HANDOFF — baca ini dulu

Dokumen untuk AI/developer berikutnya yang melanjutkan project ini. Bahasa UI dan komunikasi dengan pemilik: **Bahasa Indonesia** (santai). Kode dan komentar: Inggris/Indonesia campur, ikuti gaya yang ada.

## 1. Apa project ini
**Toko Kuota (Raja Kuota)**: web top-up/reseller produk digital (kuota, pulsa, dll) untuk pasar Indonesia. User punya **saldo**; membeli produk yang dipenuhi provider **KhfyPay**; top-up saldo via transfer bank dengan nominal unik. Ada panel admin.
Stack: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 3 + Supabase (Postgres + Auth) + Vercel. Test: Vitest + SQL (psql) + concurrency shell.

## 2. Status singkat
| Area | Status |
|---|---|
| Fondasi DB: saldo, ledger append-only, transaksi, RPC atomik, RLS/grant | selesai + teruji (SQL + concurrency, Postgres 16 lokal) |
| Auth, katalog, checkout, riwayat, detail | selesai di kode; **belum pernah dijalankan terhadap Supabase asli** |
| Admin (dashboard, user, transaksi, produk/margin, top-up manual, ledger, pengaturan, audit, monitoring, ekspor CSV) | selesai di kode, belum diuji di Supabase asli |
| Admin MFA (TOTP/aal2), profil, lupa/reset password | selesai di kode, belum diuji di Supabase asli |
| Pendaftaran hanya dengan kode undangan (0007: trigger di `auth.users`, kode sekali pakai + kedaluwarsa, halaman Admin → Kode Undangan) | selesai + teruji di DB; belum diuji di Supabase asli |
| Admin pertama dari browser: halaman `/setup` sekali pakai (env `SETUP_SECRET`, 404 bila env kosong atau admin sudah ada; migrasi 0008) | selesai + teruji di DB; belum diuji di Supabase asli |
| Admin → Diagnostik: tes env / Supabase+migrasi / KhfyPay (cek_stock_akrab, history, list_product, hanya baca) / webhook loopback; kode error, saran, detail mentah, log (tabel `diagnostic_logs`, migrasi 0009) + 20 pesan webhook terakhir | selesai + teruji unit; belum diuji dengan Supabase/KhfyPay asli |
| Top-up otomatis sisi aplikasi (permintaan nominal unik, instruksi, antrian review, konfirmasi admin, batas kredit harian admin) | selesai + teruji di DB |
| Landing page + animasi + validasi form client-side | selesai; sudah dilihat pemilik di localhost (login + landing lama) |
| Rate limit (Postgres), security headers, CI workflow | selesai; CSP belum diuji di browser nyata; CI belum pernah jalan di GitHub |
| Telegram alert + digest harian | selesai, belum diuji dengan bot nyata |
| **KhfyPay parser / webhook status / verifikasi /history (Tahap 2B)** | **BELUM** (menunggu sample asli dari provider) |
| **Deteksi transfer otomatis (4B)** | **BELUM** (client memilih transfer BRI saja, TANPA QRIS; tinggal putuskan cek-mutasi atau tetap konfirmasi manual) |
| **Project BELUM siap produksi** | lihat `docs/06-PRODUCTION-GATE.md` |

## 3. Cara menjalankan
```bash
node -v                      # perlu >= 20 (disarankan 22)
npm install
cp .env.example .env.local   # isi; penjelasan: docs/08-ENV.md
npm run doctor               # cek Node, dependency, env (tidak menampilkan nilai)
npm run dev                  # atau npm run dev:turbo (lebih cepat saat kompilasi)
```
Kualitas: `npm run typecheck && npm run lint && npm test && npm run build`.
SQL + concurrency (butuh Postgres lokal, BUKAN project Supabase asli): `PSQL="psql -U postgres" ./supabase/tests/run.sh`.
Tes TypeScript ke Postgres asli: terapkan migrasi 0001..0009 + `supabase/tests/00_supabase_stub.sql` ke DB scratch, matikan gerbang undangan di DB scratch itu (`alter table auth.users disable trigger enforce_invite_on_signup`, karena tes membuat user langsung), lalu `TEST_DATABASE_URL=... npm run test:db`. Pipeline yang sama ada di `.github/workflows/ci.yml`.

## 4. Peta kode (ringkas)
```
supabase/migrations/0001..0009   skema, RLS, RPC (sumber kebenaran logika uang)
supabase/tests/                  SQL behavior (10..15), concurrency (20_concurrency.sh), stub Supabase
src/lib/providers/               ProviderAdapter + khfypay/ (wire.ts, request-builder, http, parsers [TODO], webhook [TODO status])
src/lib/transactions/            rpc wrappers, checkout (sendIfClaimed), webhook-processor, reconcile (dimatikan), policy
src/lib/topup/                   rpc wrappers, schemas, ingestIncomingTransfer (pintu masuk deteksi transfer)
src/lib/admin/                   auth (role dari DB + MFA), schemas, queries (RPC read), mutation wrappers
src/lib/security/                rate-limit, headers (CSP), origin, redact, timing
src/app/                         (auth), (app) user, admin/, api/ (checkout, webhook, cron), webhook/[token], mfa, topup
docs/                            00..14, baca terutama 04, 06, 07, 09, 10, 11, 12, 13
```

## 5. INVARIAN: jangan dilanggar
1. **Saldo, ledger, dan status transaksi hanya berubah lewat RPC SQL** (trigger guard menolak jalur lain). Jangan pernah menulisnya dari Node/browser/SQL manual.
2. **Harga dari database.** `expectedPrice` dari klien hanyalah pengaman cache basi, bukan harga.
3. **`reff_id` dibuat DB sekali dan tidak berubah**; retry memakai reff_id yang sama.
4. **Hanya `sendIfClaimed` yang boleh memanggil `/trx`**, dan hanya setelah memenangkan klaim atomik `claim_provider_send` (compare-and-set `provider_attempts 0→1`). Jangan pernah "baca attempts lalu putuskan".
5. **Timeout / network error / respons tidak dikenali = tetap PENDING.** Tidak ada refund otomatis. Checkout tidak punya jalur finalize sama sekali.
6. **Refund hanya lewat `finalize_transaction_failed`**, sekali (unique ledger `(transaction_id, type)`).
7. **Jangan menebak format provider.** Parser yang belum ada mengembalikan `null` → adapter menjawab `unparsed` → gagal-aman. Semua gap ada di `wire.ts`, `parsers.ts`, `webhook.ts`.
8. KhfyPay **tidak** punya signature webhook. Pertahanan kita: secret di path URL (`/webhook/<WEBHOOK_SECRET>`, satu-satunya URL webhook; `?token=` ditolak), korelasi `reff_id` milik kita, transaksi memang sudah dikirim (`provider_attempts>0`), state machine terkunci, dan (target 2B) verifikasi `/history`.
9. Admin: peran dibaca dari DB (bukan JWT/browser), sesi harus **aal2** (MFA) kecuali `ADMIN_MFA_REQUIRED=false`; **setiap RPC admin mengecek ulang admin di Postgres dan menulis audit**.
10. Top-up: satu PENDING per (bank, nominal total); kredit **sekali** (unique `bank_ref`, status request, ledger idempotency key); transfer telat/tidak cocok masuk antrian, **tidak** dikredit otomatis; ada batas kredit manual harian per admin.
11. **Field form kosong tidak boleh menjadi 0**: `z.coerce.number()` mengubah `""` jadi `0`. Pakai `z.string().trim().min(1).pipe(z.coerce.number()...)`.
12. Fungsi baru di schema `public` harus `revoke ... from public, anon, authenticated` dan `grant execute ... to service_role`. `supabase/tests/14_hardening_tests.sql` gagal jika ada yang terbuka.
13. Secret tidak boleh masuk log/respons/DB: `redactAndTruncate`, token Telegram/KhfyPay tidak pernah dicetak. `KHFYPAY_*` terpisah dari env Supabase (aplikasi harus tetap jalan tanpa `KHFYPAY_*`).
14. Harga/saldo selalu integer rupiah (`bigint`), tanpa float.
15. `KHFYPAY_*` jangan diisi di environment sebelum 2B selesai.

## 6. Keputusan penting + alasannya
- Top-up = **transfer bank nominal unik**, saldo masuk = **nominal yang ditransfer** (kode unik bukan biaya). Client tidak mau ada biaya layanan ke user. Batas default (bisa diubah di Admin → Pengaturan): min Rp 10.000, maks Rp 2.000.000, kode 1–999, berlaku 24 jam (usulan developer, belum dikonfirmasi client).
- Bank pertama: **BRI** (dikonfirmasi client). Nomor rekening **diisi admin di dashboard**, tidak ada di kode/dokumen/test; jangan simpan nomor rekening di repo.
- Admin **tidak** punya tombol "tandai sukses/refund manual" (sengaja, sampai 2B).
- Katalog cache 5 menit (`unstable_cache`); sinkron provider tidak menimpa `margin`, `is_active`, metadata tampilan; produk baru mulai nonaktif.
- Halaman baca memakai `getClaims()` (verifikasi JWT lokal, cepat); aksi uang/akun memakai `getUser()` (tanya Supabase Auth).
- Rate limiter di Postgres (`rate_limit_hit`), fail-open jika error.
- Vercel Hobby hanya mengizinkan cron harian → rekonsiliasi berkala perlu Pro / penjadwal lain.

## 7. YANG BELUM TERVERIFIKASI (jujur)
Tidak pernah dijalankan terhadap project Supabase asli: login/register/email, middleware `getClaims`, query RLS-client, RPC dari `supabase-js` (PostgREST), MFA, profil, ekspor, halaman admin secara visual. CSP belum dilihat di browser. UI belum diaudit aksesibilitas dengan alat otomatis. CI belum pernah jalan di GitHub. Alert Telegram belum dikirim ke bot nyata. **Langkah pertama yang disarankan: staging end-to-end (`docs/10-STAGING-CHECKLIST.md`).**

## 8. Urutan kerja yang disarankan
1. Staging di Supabase + Vercel, jalankan checklist `docs/10`, perbaiki temuan.
2. Dapatkan sample KhfyPay → kerjakan `docs/13-SPEC-TAHAP-2B-KHFYPAY.md`.
3. Putuskan jalur deteksi top-up BRI: `docs/07-TOPUP.md` (4B, cek mutasi) atau tetap konfirmasi manual. QRIS/gateway DIBATALKAN oleh client (docs/12 hanya arsip).
4. Kerjakan backlog `docs/11-BACKLOG-BELUM-DIKERJAKAN.md` sesuai prioritas.
5. Lewati seluruh `docs/06-PRODUCTION-GATE.md` sebelum menerima uang sungguhan.
