# Toko Kuota — Raja Kuota

Next.js (App Router) + TypeScript + Tailwind + Supabase + KhfyPay. Baca `docs/00`–`08` dulu.

## Status
- Tahap 1–3 (fondasi, aplikasi inti, admin + UI): selesai.
- Hardening (rate limiting, security headers, lupa/reset password, halaman hukum draft, CI): selesai. Lihat docs/06.
- Top-up otomatis, sisi aplikasi (4A): selesai. **Deteksi transfer otomatis (4B) belum dibuat**, lihat docs/07. Top-up mati secara default.
- **Tahap 2B ditahan dan project BELUM siap produksi**: sample JSON KhfyPay dan contoh webhook belum ada, jadi katalog kosong dan transaksi belum bisa difinalisasi. Lihat docs/04 dan docs/06.

Panduan lain: **AI-HANDOFF.md (baca dulu)**, docs/08-ENV.md (env var), docs/09-RUNBOOK.md (insiden), docs/10-STAGING-CHECKLIST.md (deploy staging), docs/11-BACKLOG-BELUM-DIKERJAKAN.md (yang belum dikerjakan), docs/12-SPEC-PAYMENT-GATEWAY-WIJAYAPAY.md, docs/13-SPEC-TAHAP-2B-KHFYPAY.md.

## Menjalankan di komputer sendiri

**Syarat:** Node.js **22 LTS** (minimal 20). Cek dengan `node -v`. Kalau lebih lama, install dari https://nodejs.org lalu buka terminal baru.

```bash
# 1. masuk ke folder project: folder yang LANGSUNG berisi package.json
#    (hasil unzip biasanya berupa folder toko-kuota di dalam folder lain)
cd toko-kuota

# 2. pasang dependency
npm install

# 3. buat file env (pilih sesuai sistem operasi), lalu isi nilainya, lihat docs/08-ENV.md
cp .env.example .env.local                    # macOS / Linux / PowerShell
copy .env.example .env.local                  # Windows CMD

# 4. cek semuanya sudah benar (tidak menampilkan nilai rahasia)
npm run doctor

# 5. jalankan
npm run dev                                   # buka http://localhost:3000
```

Halaman depan, syarat, dan privasi jalan tanpa env. Login, katalog, dan admin butuh project Supabase (migrasi di bawah) dan env terisi.

### Database (Supabase)
Jalankan file di `supabase/migrations/` **berurutan** (0001 sampai 0008) di SQL Editor Supabase, atau pakai `supabase db push`. Cara tercepat: tempel isi `supabase/ALL_MIGRATIONS.sql` (gabungan semuanya) sekali di SQL Editor lalu Run. Jangan dijalankan dua kali. Kalau sudah terlanjur error/jalan sebagian di project yang masih kosong: Run `supabase/00_RESET_DB.sql` (menghapus semua tabel di schema public), lalu `ALL_MIGRATIONS.sql` lagi.
**Admin pertama (tanpa SQL Editor):** pendaftaran biasa hanya dengan kode undangan (migrasi 0007), jadi admin pertama dibuat lewat halaman setup sekali pakai:
1. Di Vercel isi env `SETUP_SECRET` (acak, minimal 24 karakter, lihat `docs/08-ENV.md`), lalu deploy ulang.
2. Buka `https://<domain>/setup`, isi secret, email, dan password admin, lalu klik **Buat admin**.
3. Login di `/login` (admin wajib MFA/TOTP: siapkan aplikasi authenticator). Setelah itu halaman `/setup` hilang sendiri (404); **hapus `SETUP_SECRET` dari Vercel**.
4. Seterusnya kode undangan dibuat dari Admin → Kode Undangan.

Di Supabase → Authentication → URL configuration: isi Site URL dan tambahkan `https://<domain>/auth/callback` ke Redirect URLs.
Pasang SMTP sendiri sebelum ada user nyata (pengirim email bawaan sangat terbatas).

### Kalau ada masalah

| Gejala | Penyebab paling umum | Perbaikan |
|---|---|---|
| `'next' is not recognized...` / `next: command not found` | `npm install` belum selesai atau dijalankan di folder yang salah | Pastikan ada `package.json` di folder tempat kamu mengetik (`dir` / `ls`). Hapus folder `node_modules` lalu `npm install` lagi, dan baca pesan **error** (bukan warn) yang pertama |
| Banyak `EBADENGINE` / `Unsupported engine` | Node terlalu lama | Pasang Node 22 LTS |
| `npm warn deprecated rimraf / glob / inflight / eslint@8 / @humanwhocodes/...` | Peringatan dari ESLint 8 (alat pengecek kode) | **Aman diabaikan.** Bukan error, tidak mempengaruhi aplikasi |
| `npm audit: 2 vulnerabilities` | Dependency bawaan Next.js, hanya saat build | Sudah diketahui, bukan blocker. **Jangan** jalankan `npm audit fix --force` (bisa merusak versi) |
| Install gagal/aneh di folder OneDrive, Google Drive, flashdisk | Sistem file tidak mendukung symlink yang dipakai `node_modules/.bin` | Pindahkan project ke folder biasa, misalnya `C:\dev\toko-kuota`, lalu install ulang |
| `npm install` tidak memasang `typescript`/`tailwindcss` | Variabel `NODE_ENV=production` atau `npm config omit=dev` aktif | Cek `npm config get omit`; hapus pengaturannya lalu install ulang |
| Halaman error "Invalid/missing environment variables: ..." | Ada variabel wajib yang kosong | `npm run doctor` menunjukkan yang mana, lalu isi di `.env.local` dan restart `npm run dev` |

## Pengecekan kode
```bash
npm run typecheck && npm run lint && npm test && npm run build
PSQL="psql -U postgres" ./supabase/tests/run.sh   # tes SQL + concurrency di Postgres lokal (bukan project Supabase kamu)
TEST_DATABASE_URL=postgres://… npm run test:db    # tes TypeScript ke PostgreSQL asli (migrasi 0001..0008 sudah diterapkan)
```
Pengecekan yang sama berjalan otomatis di `.github/workflows/ci.yml`.

## Deploy
Vercel + Supabase. Isi env di Vercel (Settings → Environment Variables) sesuai docs/08-ENV.md.
Provider callback yang didaftarkan: `https://<domain>/webhook/<WEBHOOK_SECRET>`.
Vercel Cron memanggil `/api/cron/sync-products` dan `/api/cron/expire-topups` setiap hari (`vercel.json`); butuh `CRON_SECRET`.
