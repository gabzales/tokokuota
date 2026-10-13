# 08 — Penjelasan environment variable (env var)

**Env var = pengaturan rahasia/alamat yang disimpan di luar kode.** Kodenya sama di mana-mana, tapi nilainya beda
untuk tiap tempat (laptop kamu, staging, produksi). Jadi password dan kunci tidak ikut tersimpan di GitHub.

- **Di laptop:** ditulis di file `.env.local` (salin dari `.env.example`). File ini tidak boleh di-commit atau dibagikan.
- **Di Vercel:** Project → *Settings* → *Environment Variables* → isi nama dan nilainya satu per satu, lalu *Redeploy*.
- Awalan **`NEXT_PUBLIC_`** artinya nilainya *boleh terlihat di browser*. Variabel **tanpa** awalan itu hanya hidup di server, jadi aman untuk yang rahasia.
  **Jangan pernah** memberi awalan `NEXT_PUBLIC_` pada kunci rahasia.

## Wajib sekarang

| Nama | Apa itu | Dari mana | Rahasia? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Alamat database/login kamu di Supabase. Bentuknya `https://abcdxyz.supabase.co` | Supabase → Project Settings → **API** → *Project URL* | Tidak |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Kunci "tamu" untuk browser. Dibatasi aturan RLS sehingga hanya bisa baca data milik user sendiri | Supabase → Project Settings → **API** → kunci `anon` / `publishable` | Tidak (aman publik) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Kunci master**. Melewati semua pembatasan: bisa baca/ubah apa saja. Dipakai server untuk potong saldo, admin, dll | Supabase → Project Settings → **API** → kunci `service_role` / `secret` (klik *Reveal*) | **YA, sangat** |
| `WEBHOOK_SECRET` | Kata sandi buatan sendiri yang ditaruh di alamat callback untuk provider: `https://domainmu/webhook/<WEBHOOK_SECRET>`. Supaya orang lain tidak bisa mengirim callback palsu | Buat sendiri (lihat di bawah), minimal 24 karakter | **YA** |
| `CRON_SECRET` | Kata sandi buatan sendiri supaya hanya jadwal otomatis Vercel yang bisa menjalankan tugas terjadwal (sinkron katalog, bersih-bersih) | Buat sendiri, minimal 16 karakter | **YA** |

### Cara membuat `WEBHOOK_SECRET` / `CRON_SECRET`
Di terminal (sama untuk Windows/Mac/Linux, asal Node sudah terpasang):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```
Hasilnya 48 karakter acak. Salin ke `.env.local` / Vercel. Pakai nilai yang **berbeda** untuk tiap variabel.

## Opsional: membuat admin pertama dari browser

| Nama | Apa itu | Isi |
|---|---|---|
| `SETUP_SECRET` | Kata sandi buatan sendiri untuk halaman sekali pakai `/setup` (membuat akun admin pertama tanpa SQL). Kosong = halaman `/setup` mati (404). Setelah admin pertama jadi, halaman itu hilang sendiri; **hapus variabel ini dari Vercel** | Buat sendiri, minimal 24 karakter (perintah di atas), berbeda dari secret lain |

## Disarankan

| Nama | Apa itu | Isi |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Alamat situs. Dipakai untuk menyusun tautan di email (konfirmasi pendaftaran, reset password) | Lokal: `http://localhost:3000`. Produksi: `https://toko-kuota.web.id` |

## Opsional

| Nama | Apa itu | Kapan dipakai |
|---|---|---|
| `CSP_REPORT_ONLY` | Isi `1` untuk membuat pengaman browser (CSP) hanya *mencatat* pelanggaran, tidak memblokir | Kalau setelah deploy ada halaman yang tiba-tiba rusak. Ini tombol mundur tanpa deploy ulang |

## Opsional: alert Telegram dan MFA

| Nama | Apa itu | Cara dapat |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram untuk mengirim notifikasi ke admin. **Rahasia.** | Chat ke @BotFather → `/newbot` |
| `TELEGRAM_CHAT_ID` | Tujuan notifikasi (chat/grup) | Kirim pesan ke bot, lalu buka `https://api.telegram.org/bot<TOKEN>/getUpdates` dan salin `chat.id` |
| `ADMIN_MFA_REQUIRED` | Wajib verifikasi dua langkah (authenticator) untuk admin. Defaultnya **wajib**; isi `false` hanya untuk pengembangan lokal | biarkan kosong |

Kalau dua variabel Telegram kosong, alert tidak dikirim (tidak error).

## Nanti, KOSONGKAN DULU

| Nama | Apa itu | Kenapa dikosongkan |
|---|---|---|
| `KHFYPAY_BASE_URL`, `KHFYPAY_API_KEY`, `KHFYPAY_TIMEOUT_MS` | Alamat, kunci, dan batas waktu untuk menghubungi KhfyPay. `KHFYPAY_BASE_URL=https://panel.khfy-store.com/api_v2` (boleh diisi sekarang, hanya dipakai tes Diagnostik dan belum ada produk yang bisa dibeli; sudah termasuk `/api_v2`, tanpa garis miring di akhir; `/api_v3/cek_stock_akrab` otomatis diarahkan dari host-nya) | Diisi hanya setelah Tahap 2B selesai. Kalau diisi sekarang, setiap pembelian sungguhan dikirim ke KhfyPay padahal hasilnya belum bisa dibaca aman. Selama kosong, aplikasi tetap jalan dan pembelian gagal *sebelum* saldo dipotong |

## Yang BUKAN env var (diatur di dashboard admin)
Margin default produk baru, mode pemeliharaan, pengumuman, batas top-up, masa berlaku top-up, dan nomor rekening
diatur di **Admin → Pengaturan** dan **Admin → Rekening Top-up**, bukan di file env.

## Cek cepat
`npm run doctor` memeriksa versi Node, apakah paket terpasang, dan apakah semua variabel wajib sudah terisi dengan format benar.
Perintah itu **tidak pernah menampilkan nilai** variabel, hanya OK / GAGAL dan cara memperbaikinya.
