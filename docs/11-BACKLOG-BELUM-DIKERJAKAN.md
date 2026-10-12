# 11 — Backlog: yang BELUM dikerjakan

Legenda: **[BLOCKED]** menunggu data/keputusan pihak luar · **[DEV]** bisa langsung dikerjakan · **P0** wajib sebelum uang sungguhan · **P1** segera setelahnya · **P2** nanti.
Tiap item punya kriteria selesai (DoD). Ikuti invarian di `AI-HANDOFF.md`.

## P0: blokir produksi

### B1 [BLOCKED] KhfyPay Tahap 2B: parser, status webhook, verifikasi /history
Rinci di `docs/13-SPEC-TAHAP-2B-KHFYPAY.md`. Butuh: sample JSON `/list_product`, `/trx`, `/history`; contoh pesan webhook SUKSES dan GAGAL; aturan `reff_id` provider; API key.
DoD: parser + fixture + tes; `STATUS_EXTRACTORS` terisi; `verify` via `/history` aktif; `POLICY.RECONCILE_ENABLED=true` dengan jadwal; tes live/sandbox: sukses, gagal+refund sekali, timeout→PENDING→selesai via webhook, webhook ganda, webhook palsu ditolak.

### B2 [DEV] Staging end-to-end di Supabase + Vercel asli
Ikuti `docs/10-STAGING-CHECKLIST.md`. DoD: semua kotak A–D tercentang; tidak ada error CSP di console; bug yang ditemukan diperbaiki + tes regresi. Tambahkan tes e2e browser (Playwright) untuk alur: daftar → login → lupa password → admin MFA → top-up manual → checkout (dengan provider ter-stub di staging).

### B3 [BLOCKED] Deteksi top-up otomatis BRI (4B)
Keputusan client: top-up hanya transfer BRI, **tanpa QRIS/payment gateway** (opsi b dibatalkan). Pilih satu:
- (a) Layanan cek mutasi bank (Moota/Mutasibank, dukungan BRI harus dikonfirmasi) → handler webhook → `ingestIncomingTransfer`. Lihat `docs/07-TOPUP.md`.
- (b) ~~Payment gateway QRIS~~ DIBATALKAN client. Jangan dikerjakan.
- (c) Tetap manual (konfirmasi admin): sudah jalan.
DoD: callback terotentikasi (signature/secret sesuai dokumentasi), idempoten, jumlah cocok persis, tes konkurensi, tes e2e dengan transfer/pembayaran kecil sungguhan.

### B4 [DEV setelah B1] Jalur penyelesaian PENDING yang menggantung
Saat ini tidak ada cara aman menutup transaksi PENDING lama selain webhook//history. Rancang: admin "ajukan penyelesaian" (SUKSES/GAGAL+bukti) → **persetujuan admin kedua** → panggil `finalize_*` yang sama. Semua tercatat di audit; kredit/refund tetap sekali.
DoD: RPC `request_manual_finalization` + `approve_manual_finalization` (dua admin berbeda), UI, tes SQL + konkurensi, alert Telegram.

### B5 [DEV/OPS] Operasional produksi
SMTP sendiri di Supabase (+ SPF/DKIM); backup harian + **PITR** dan uji pemulihan; MFA TOTP aktif di Supabase Auth; domain `toko-kuota.web.id` + HTTPS; `NEXT_PUBLIC_SITE_URL`; monitoring error (mis. Sentry) + uptime check; isi Syarat & Ketentuan / Kebijakan Privasi (ada placeholder kuning `[...]`) dan tinjauan hukum; cek syarat bank untuk menampung dana user; pilih paket Vercel/Supabase sesuai ketentuan komersial.

### B6 [DEV] Verifikasi hal yang belum diuji (lihat `AI-HANDOFF.md` bagian 7)
Jalankan CI di GitHub, pastikan hijau; uji Telegram nyata; uji CSP (`CSP_REPORT_ONLY=1` jika perlu); audit aksesibilitas (axe/Lighthouse) dan perbaiki; uji tampilan HP nyata.

## P1

### B7 [DEV] Persetujuan ganda untuk kredit manual besar
Saat ini hanya ada batas harian per admin (`admin_credit_daily_cap`). Tambahkan: kredit ≥ ambang (setting) masuk status "menunggu persetujuan admin lain". DoD: RPC + UI + tes konkurensi (dua admin menyetujui bersamaan).

### B8 [BLOCKED B1] Pemantauan saldo provider
Alert saat saldo KhfyPay rendah (butuh endpoint cek saldo yang terdokumentasi; jangan menebak). Tampilkan di dashboard admin.

### B9 [BLOCKED B1] Produk hilang dari provider otomatis `is_available=false`
Di `sync_products`/sync service: tandai produk yang tidak ada di daftar terbaru (hanya jika parse sukses & daftar tidak kosong). Jangan menyentuh `margin`/`is_active`.

### B10 [DEV] Notifikasi ke user
Email/WhatsApp saat transaksi berhasil/gagal dan saldo masuk. Butuh pilihan kanal + SMTP/WA provider. Jangan memasukkan data sensitif di pesan.

### B11 [DEV] Generate tipe database
`supabase gen types typescript` → `src/types/database.ts`; ganti cast manual (`as X`) di `store.ts`, `queries.ts`, halaman. DoD: tidak ada `as` manual untuk hasil query; typecheck bersih.

### B12 [DEV] Tes e2e + aksesibilitas otomatis + tes beban
Playwright (e2e), axe-core (a11y), k6/autocannon (beban: katalog, checkout, webhook). Tentukan target latensi.

### B13 [DEV] Reseller API (jika client menginginkannya)
API key per user (di-hash), endpoint produk/order/status/saldo, callback bertanda tangan HMAC, rate limit, whitelist IP opsional, sandbox, dokumentasi. **Jangan dibuka sebelum gate produksi lewat.**

## P2

- B14 Panel admin: tombol "buat produk manual", pencarian trigram sudah ada tapi belum dipakai optimal pada ledger note; grafik harian; filter tanggal di semua daftar.
- B15 CSP berbasis nonce (hilangkan `'unsafe-inline'` untuk script).
- B16 Sinkronkan `profiles.email` saat user mengganti email di Auth (trigger pada `auth.users` update).
- B17 Halaman profil: ganti email, hapus akun (ikuti kewajiban pencatatan).
- B18 Upgrade Next.js saat advisory postcss (build-time) punya perbaikan; jalankan `npm audit` rutin.
- B19 Cron rekonsiliasi berkala (butuh Vercel Pro atau penjadwal eksternal) + digest lebih sering.
- B20 Hapus `ProviderAdapter.checkAkrabStock` jika memang tidak akan dipakai; rapikan regex UUID yang terduplikasi (6 file) ke util.
- B21 Ekspor CSV untuk riwayat user (self-service).
- B22 Uji beban `staleTimes` (router cache 20 detik): pastikan saldo tidak terlihat basi setelah webhook/kredit eksternal.

## Masalah yang diketahui
- Laporan pemilik soal QRIS tidak terdeteksi: tidak relevan lagi, client memutuskan top-up hanya lewat transfer BRI (tanpa QRIS). Penyelesaian sementara tetap: cek mutasi BRI lalu Admin → Top-up → Konfirmasi.
- Landing: simulasi top-up memakai angka contoh (min 10.000, maks 2.000.000, kode 1–999) yang tidak terhubung ke pengaturan admin.
- Peringatan npm `deprecated` (ESLint 8) aman; 2 temuan `npm audit` dari postcss bawaan Next (build-time).
