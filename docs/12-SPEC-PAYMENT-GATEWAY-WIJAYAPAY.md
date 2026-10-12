# 12 — Spesifikasi: top-up via payment gateway QRIS (WijayaPay atau sejenis)

Status: **DIBATALKAN (arsip)**. Client memutuskan top-up hanya lewat transfer BRI, tanpa QRIS/payment gateway. Jangan dikerjakan kecuali keputusan berubah.

Latar belakang awal: belum dikerjakan. Dibuat karena pemilik melaporkan pembayaran QRIS (lewat payment gateway) tidak terdeteksi dan bertanya apakah WijayaPay bisa dipakai beserta webhook-nya.

## 1. Kenapa tidak terdeteksi sekarang
Kode saat ini **tidak memiliki integrasi QRIS/payment gateway apa pun**: tidak ada pemanggilan API gateway, tidak ada endpoint callback gateway, tidak ada pencocokan pembayaran gateway. Satu-satunya top-up yang ada: transfer bank nominal unik (konfirmasi manual admin, atau deteksi otomatis 4B yang belum dibuat). Permintaan top-up akan tetap `PENDING` sampai ada yang mengkreditkannya.
**Solusi sementara untuk pembeli yang sudah bayar:** cek pembayaran di dashboard gateway/bank → bila benar masuk dan permintaan top-up ada di aplikasi: Admin → Top-up → Permintaan → **Konfirmasi** (catatan wajib; tercatat di audit; tunduk pada batas kredit harian admin). Bila tidak ada permintaannya: Admin → User → Top-up manual.

## 2. Apa yang diketahui tentang WijayaPay (dari pencarian publik, BUKAN dari dokumentasi lengkap)
- Situs dokumentasi: `https://docs.wijayapay.com/` dengan bagian: Pendahuluan, Metode Pembayaran, **Get Payment**, **Generate Payment**, **Cek Status Pembayaran**, **Callback / Webhook**.
- README paket PHP (disebut "official PHP wrapper") menunjukkan pembuatan transaksi dengan parameter `ref_id`, `code_payment` (contoh `QRIS`), `nominal`, dan penanganan webhook: parse data masuk lalu membalas respons sukses ke WijayaPay.
- **TIDAK diketahui (wajib dibaca dari dokumentasi/akun sebelum menulis kode):** base URL, skema autentikasi (header/key/signature), bentuk respons Generate Payment (string QR/gambar, waktu kedaluwarsa, id transaksi), daftar status, **bentuk payload webhook dan tanda tangan/verifikasinya**, kebijakan retry, IP callback, batas nominal, **biaya (MDR/fee) dan siapa yang menanggung**, sandbox, aturan `ref_id` (panjang/karakter/unik), cut-off settlement.
**Jangan menebak satu pun.** Minta pemilik: akses dokumentasi lengkap + akun sandbox + contoh respons asli Generate Payment, Cek Status, dan webhook (sukses, gagal, kedaluwarsa).

## 3. Keputusan bisnis yang harus dikonfirmasi lebih dulu
1. Client sebelumnya **tidak mau ada biaya layanan ke user** dan memilih transfer langsung ke rekening. QRIS gateway biasanya memotong MDR/fee. Siapa yang menanggung? Apakah saldo yang dikredit = nominal bruto yang dibayar user (fee ditanggung toko) atau neto?
2. Apakah QRIS menggantikan transfer nominal unik atau menjadi pilihan tambahan? (Rekomendasi: pilihan tambahan.)
3. Batas nominal, masa berlaku QR, dan perlakuan pembayaran yang telat/tidak cocok.

## 4. Desain yang diusulkan (migrasi 0007)
Pencocokan gateway memakai **referensi eksternal**, bukan nominal unik; karena itu indeks unik nominal harus hanya berlaku untuk metode transfer bank.
- `topup_requests`: tambah `method text not null default 'BANK_TRANSFER' check (method in ('BANK_TRANSFER','GATEWAY'))`, `gateway text`, `external_ref text`, `gateway_payload jsonb` (server-only; berisi QR/instruksi), `external_status text`. `bank_id/bank_code` dibuat nullable untuk GATEWAY (atau pakai baris `topup_banks` khusus). Ubah indeks `topup_requests_pending_nominal` menjadi **partial hanya untuk `method='BANK_TRANSFER'`**. Tambah `unique (gateway, external_ref) where external_ref is not null`. `unique_code` = 0 untuk GATEWAY.
- RPC `create_gateway_topup_request(user, amount, idempotency_key, gateway)`: validasi min/max, batas pending per user, buat request `PENDING` (tanpa memanggil jaringan di dalam transaksi DB).
- App memanggil **Generate Payment** dengan `ref_id` = id request (atau referensi pendek unik), lalu RPC `attach_gateway_payment(request_id, external_ref, payload, expires_at)`. Jika pemanggilan gateway gagal/timeout: request tetap `PENDING` tanpa QR dan **tidak mengkredit apa pun**; user bisa mencoba lagi (idempoten pada key yang sama) atau batal.
- RPC `record_gateway_payment(gateway, external_ref, amount, gateway_status, paid_at, raw)`, **idempoten dan terkunci baris**: kredit penuh sekali jika `status=PAID`, `amount` = nominal request persis, request masih `PENDING`/belum kedaluwarsa menurut waktu bayar; selain itu masuk antrian review (`topup_transfers` dengan `bank_code='QRIS'` atau tabel serupa). Ledger `TOPUP` dengan idempotency key `gw:<gateway>:<external_ref>`.
- Endpoint webhook baru, mis. `POST/GET /webhook/pay/<WEBHOOK_PAY_SECRET>` (path terpisah dari webhook KhfyPay): (1) autentikasi sesuai dokumentasi gateway (signature/HMAC/IP) dengan perbandingan constant-time + perlindungan replay bila ada timestamp; (2) **jangan percaya isi callback saja**: panggil **Cek Status Pembayaran** ke gateway untuk mengonfirmasi `PAID` dan nominal sebelum mengkredit (pertahanan callback palsu); (3) panggil `record_gateway_payment`; (4) balas respons sukses persis seperti yang diminta gateway; (5) log audit di `provider_webhook_events` (payload mentah server-only, tanpa secret).
- Rekonsiliasi: cron harian (dan tombol admin) memeriksa request `GATEWAY` `PENDING` yang lebih tua dari N menit lewat Cek Status; yang `PAID` dikreditkan lewat RPC yang sama; yang `EXPIRED/FAILED` ditandai.
- UI `/topup`: pilihan metode (Transfer bank / QRIS); halaman `/topup/[id]` untuk QRIS menampilkan QR (data URI atau gambar dari gateway; perhatikan CSP `img-src`), hitung mundur, auto-refresh, tombol batal.
- Admin: filter metode di `/admin/topups`, tampilkan `external_ref`, status gateway, dan tombol "Cek status ke gateway".

## 5. Tes yang wajib ada
SQL: kredit sekali pada callback ganda (konkurensi 25x), nominal tidak cocok → antrian, callback setelah kedaluwarsa → antrian, balapan callback vs konfirmasi admin → satu kredit, `external_ref` ganda ditolak, request `GATEWAY` tidak mengunci nominal untuk transfer bank. TypeScript: verifikasi signature (benar/salah/replay), parser dari **fixture asli**, gagal-aman bila format tidak dikenali, tidak pernah mengkredit dari redirect/return URL. E2E: pembayaran sandbox kecil.

## 6. Keamanan
Secret gateway dan secret webhook hanya di env server (tambahkan ke `docs/08-ENV.md` dan `scripts/doctor.mjs`), tidak pernah di log/respons; batas jumlah per transaksi/harian; alert Telegram untuk callback tidak biasa; jangan menampilkan payload mentah ke user.

## 7. Estimasi urutan kerja
1) dapatkan dokumentasi + sandbox + sample → 2) fixture + tes parser/signature → 3) migrasi 0007 + tes SQL → 4) RPC + wrapper TS → 5) endpoint webhook + verifikasi status → 6) UI → 7) rekonsiliasi → 8) tes e2e sandbox → 9) perbarui `docs/06` (gate T1–T7) dan `docs/07`.
