# 13 — Spesifikasi: Tahap 2B KhfyPay (finalisasi transaksi)

Status: **ditahan** menunggu sample asli. Konteks aturan: `AI-HANDOFF.md` (invarian 4–8) dan `docs/04-KHFYPAY-API-INTEGRATION.md`.

## Data yang dibutuhkan dari pemilik/provider
1. API key + dokumentasi terbaru. 2. Respons JSON asli: `/list_product`, `/trx` (sukses, gagal, pending), `/history` (per `refid`). 3. Contoh **pesan webhook** untuk SUKSES dan GAGAL (+ konfirmasi apakah callback GET/POST). 4. Aturan `reff_id` (panjang, karakter, unik) dan apa yang terjadi bila `/trx` dikirim ulang dengan `reff_id` sama. 5. Arti kode `result` di respons `/trx` sinkron (final atau hanya "diterima"). 6. Respons HTTP yang diharapkan webhook + kebijakan retry. 7. Endpoint cek saldo provider (jika ada). 8. Konfirmasi: provider tidak menghapus path/query URL callback.
Sudah diketahui: parameter `/trx` = `produk, tujuan, reff_id, api_key`; `/history` = `refid, api_key`; `/list_product` memakai `api_key`; `/api_v3/cek_stock_akrab` tidak mencantumkan `api_key`; webhook `GET /webhook?message=<message>`; `result=0` sukses, `result=1` gagal/batal.

## Langkah kerja (urut)
1. Simpan sample di `tests/fixtures/khfypay/` (hapus secret/nomor asli). 2. Isi `src/lib/providers/khfypay/parsers.ts`: `parseListProductResponse`, `parseTrxResponse`, `parseHistoryResponse`, menghasilkan tipe normal (`ProviderProduct`, `ParsedTrxResponse`, `ProviderHistoryEntry`). Format tak dikenal → `null` (gagal-aman). Tes: fixture sukses + variasi rusak. 3. Isi `STATUS_EXTRACTORS` di `webhook.ts` dari pesan nyata; ekstraktor bertentangan → `UNKNOWN`; tanpa heuristik kata tanpa sample. 4. Hubungkan `verify` di `processWebhook` ke lookup `/history` (`refid`): finalisasi hanya bila `CONFIRMED`; `CONTRADICTED` → flag review; `INCONCLUSIVE` → tetap PENDING. 5. Setelah tes lulus: `POLICY.RECONCILE_ENABLED = true` dan jadwalkan `/api/cron/reconcile` (Hobby = harian saja; pertimbangkan Pro/penjadwal eksternal). 6. Putuskan `trustSubmitResponse` (default tetap tidak mempercayai respons `/trx` sinkron kecuali sample membuktikan maknanya). 7. Sinkron katalog: aktifkan cron `sync-products` hanya setelah parser selesai; tandai produk yang hilang `is_available=false` (jangan menyentuh margin/is_active). 8. Cek `reff_id`: bila provider membatasi format/panjang, ubah generator di `reserve_balance_and_create_transaction` (migrasi baru; jangan ubah data lama). 9. Pemantauan saldo provider + alert. 10. Perbarui `docs/04`, `docs/06`.

## Tes wajib (live/sandbox kecil + otomatis)
Sukses → SUCCESS tanpa refund; gagal → FAILED + **tepat satu** refund; `/trx` timeout → tetap PENDING → selesai via webhook/`/history`; webhook ganda/bersamaan → satu efek; webhook palsu (token salah, reff_id acak, transaksi belum dikirim) ditolak/diabaikan; sinyal bertentangan → `needs_review`, uang tidak bergerak; konkurensi SUCCESS vs FAILED (sudah ada di SQL). Semua lewat RPC `finalize_*` yang ada; jangan menambah jalur finalisasi baru.

## Definition of Done
Gate 1–9 di `docs/06-PRODUCTION-GATE.md` terpenuhi; tidak ada tebakan format di kode; semua tes hijau di CI.
