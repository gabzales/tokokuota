# 09 — Runbook (apa yang dilakukan kalau ada masalah)

Alert dikirim ke Telegram (jika `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` diisi) dan ringkasan harian dikirim tiap pagi. Semua angka ada di **Admin → Ringkasan** dan **Admin → Monitoring**.
**Aturan emas:** transaksi PENDING tidak pernah di-refund atau dibuat sukses secara manual. Final hanya dari webhook/`/history` yang valid (Tahap 2B).

## 1. Transaksi "Belum terkirim" (saldo terpotong, belum ke provider)
Terjadi kalau server mati setelah reservasi. Buka Admin → Transaksi → detail → **Kirim ke provider**. Aman diklik berkali-kali: hanya satu yang menang (klaim atomik).

## 2. Transaksi PENDING lama (>10 menit, sudah terkirim)
Jangan kirim ulang. Tunggu webhook/rekonsiliasi. Kalau user komplain, cek Admin → Monitoring → "Webhook belum terselesaikan" untuk callback yang masuk. Selama 2B belum aktif, tidak ada penyelesaian manual: catat dan eskalasi ke developer.

## 3. Transaksi "Ditandai review"
Penyebab: error tak terduga saat mengirim, atau sinyal yang bertentangan (mis. gagal lalu sukses). Baca catatan di detail transaksi, selidiki, lalu **Tutup tanda review** dengan catatan. Itu tidak mengubah status atau saldo.

## 4. User bilang "sudah transfer tapi saldo belum masuk"
1. Admin → Top-up → tab **Perlu dicek**: cari nominalnya.
2. Ada transfer antri: pilih **Kreditkan ke user** (email persis, catatan wajib), atau **Abaikan** jika bukan miliknya.
3. Belum ada di antrian: cek mutasi bank. Kalau uangnya benar masuk dan permintaannya ada di tab **Permintaan**, klik **Konfirmasi** (catatan wajib).
4. Batas kredit manual harian per admin berlaku (Pengaturan → default Rp 10 juta). Kalau tercapai, naikkan batasnya (tercatat di audit) atau tunggu 24 jam.

## 5. Saldo dan ledger tidak cocok
Admin → Ringkasan → **Jalankan pengecekan integritas**. Kalau ada akun tidak cocok: hentikan top-up manual, aktifkan **mode pemeliharaan**, kumpulkan data (Mutasi Saldo, Audit), hubungi developer. Jangan edit tabel langsung.

## 6. Mode pemeliharaan
Admin → Pengaturan → Mode pemeliharaan: pembelian baru ditolak, transaksi berjalan tidak terpengaruh. Pakai saat provider gangguan atau ada anomali.

## 7. Rotasi secret
| Secret | Cara ganti |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API → rotate/regenerate, ubah di Vercel, redeploy |
| `KHFYPAY_API_KEY` | Buat key baru di panel KhfyPay, ubah di Vercel, redeploy, cabut key lama |
| `WEBHOOK_SECRET` | Buat baru, ubah di Vercel, **lalu ubah URL callback di panel provider** (`/webhook/<secret>`). Callback lama berhenti diterima |
| `CRON_SECRET` | Buat baru, ubah di Vercel, redeploy |
| `TELEGRAM_BOT_TOKEN` | @BotFather → `/revoke`, token baru ke Vercel |
Setelah rotasi, cek Admin → Audit dan alert harian untuk memastikan semuanya hidup. Rotasi segera jika ada kecurigaan bocor (tertempel di chat, commit, atau screenshot).

## 8. Admin kehilangan perangkat authenticator
Admin lain tidak bisa mereset MFA orang lain lewat aplikasi. Pemilik project Supabase: Authentication → Users → pilih user → hapus faktor MFA, lalu admin tersebut mendaftarkan authenticator baru di `/mfa`. Catat kejadian ini.

## 9. Backup dan pemulihan
Aktifkan backup harian dan **PITR** di Supabase (paket berbayar) sebelum ada saldo user. Uji pemulihan ke project terpisah sekali sebelum go-live. Jangan memulihkan ke project produksi tanpa mode pemeliharaan menyala.

## 10. Provider gangguan
Nyalakan mode pemeliharaan, pantau Admin → Monitoring. Transaksi yang sudah terkirim tetap PENDING sampai konfirmasi valid. Jangan kirim ulang manual.

## Tes koneksi cepat (Admin → Diagnostik)
Jalankan "Jalankan semua tes". Kode yang paling sering muncul: `ENV_INVALID` (env salah/tertukar, perbaiki di Vercel lalu redeploy), `SB_MIGRATION_MISSING` (migrasi kurang), `SB_BAD_KEY` (service role key salah), `NET_DNS`/`NET_TIMEOUT` (alamat salah atau diblokir), `HTTP_401/403` (API key salah atau IP belum di-whitelist di KhfyPay), `WEBHOOK_BLOCKED_BY_PLATFORM` (Vercel Deployment Protection aktif). Setiap hasil juga tercatat sebagai satu baris JSON `{"evt":"diagnostic",...}` di Vercel → Logs.
