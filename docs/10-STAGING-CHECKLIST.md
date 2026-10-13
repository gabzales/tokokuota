# 10 — Checklist deploy staging (urut, centang satu per satu)

## A. Supabase (project staging)
- [ ] Buat project; pilih region dekat (mis. Singapura). Catat URL, anon key, service_role key.
- [ ] SQL Editor: jalankan `supabase/migrations/0001` sampai `0009` **berurutan**, tanpa error.
- [ ] Authentication → URL configuration: Site URL = alamat staging; Redirect URLs += `https://<staging>/auth/callback`.
- [ ] Authentication → SMTP: pasang SMTP sendiri (pengirim bawaan sangat terbatas) dan tes kirim.
- [ ] Authentication → MFA: pastikan TOTP aktif.
- [ ] Vercel env `SETUP_SECRET` terisi (acak ≥ 24 karakter) lalu redeploy; buka `/setup`, buat admin pertama (email + password). Tes juga: secret salah ditolak; setelah admin jadi `/setup` menjadi 404.
- [ ] Hapus `SETUP_SECRET` dari Vercel setelah admin jadi.
- [ ] Admin → **Diagnostik** → "Jalankan semua tes": semua LULUS (KhfyPay boleh DILEWATI jika belum diisi). Tes yang GAGAL menampilkan kode, saran, dan detail mentah; klik "Salin laporan lengkap" untuk dikirim ke developer.
- [ ] Tes gerbang pendaftaran: daftar tanpa kode ditolak; kode yang sama dipakai dua kali ditolak; kode kedaluwarsa/dicabut ditolak; panggilan langsung ke Supabase Auth `signUp` tanpa kode juga ditolak.
- [ ] Admin → Kode Undangan: buat kode, salin, cabut kode yang belum dipakai.

## B. Vercel
- [ ] Import repo; framework Next.js; pilih region fungsi yang dekat dengan Supabase.
- [ ] Environment Variables (lihat docs/08-ENV.md): 3 kunci Supabase, `NEXT_PUBLIC_SITE_URL`, `WEBHOOK_SECRET`, `CRON_SECRET`; opsional `TELEGRAM_*`.
- [ ] `KHFYPAY_BASE_URL` (`https://panel.khfy-store.com/api_v2`) dan `KHFYPAY_API_KEY` BOLEH diisi sekarang: katalog masih kosong (parser belum ada) sehingga belum ada produk yang bisa dibeli, dan tes Diagnostik hanya membaca (tidak pernah memanggil `/trx`). Jangan aktifkan `RECONCILE_ENABLED`.
- [ ] Deploy; buka URL; cek `/api/health` = `{"ok":true}`.

## C. Uji manual (buka DevTools → Console; tidak boleh ada error CSP)
- [ ] Landing: simulasi top-up, FAQ, tombol Daftar/Masuk.
- [ ] Daftar → email konfirmasi tiba → klik tautan → masuk. Coba juga tautan di browser lain (harus ada pesan ramah).
- [ ] Lupa password → email → atur ulang → login dengan password baru.
- [ ] Salah password 9 kali berturut-turut → muncul "Terlalu banyak percobaan".
- [ ] `/admin` sebagai non-admin = 404. Sebagai admin: diarahkan ke `/mfa`, pasang authenticator, masuk.
- [ ] Admin: Pengaturan, Rekening Top-up (isi rekening uji), buat user uji, Top-up manual kecil, lihat Mutasi Saldo, Audit, ekspor CSV (buka di Excel/Sheets).
- [ ] Nyalakan top-up, buat permintaan sebagai user uji, konfirmasi manual sebagai admin; saldo bertambah sekali (klik konfirmasi dua kali = tetap sekali).
- [ ] Mode pemeliharaan: nyalakan, coba beli (ditolak), matikan.
- [ ] Profil: ganti nama dan password.
- [ ] Alert Telegram masuk saat aksi admin (jika dikonfigurasi).

## D. Cron
- [ ] Panggil manual: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<staging>/api/cron/expire-topups` = `ok:true`.
- [ ] Tanpa header = 401.

## E. Sebelum produksi (belum boleh sebelum ini semua centang, lihat docs/06)
- [ ] Sample JSON KhfyPay + webhook sukses/gagal, parser, verifikasi `/history`, tes live kecil, tes refund.
- [ ] Backup + PITR aktif dan pernah diuji pulih.
- [ ] Syarat/Privasi diisi pemilik dan ditinjau.
- [ ] Domain `toko-kuota.web.id` + HTTPS; `NEXT_PUBLIC_SITE_URL` produksi.
