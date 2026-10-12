"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/action-state";
import { ActionForm } from "./ActionForm";
import { SubmitButton } from "./SubmitButton";
import { Field, inputCls } from "./ui";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function TopupForm({ action, userId, idempotencyKey }: { action: Action; userId: string; idempotencyKey: string }) {
  // key={idempotencyKey}: after a successful top-up the page re-renders with a NEW key and the form resets.
  return (
    <ActionForm key={idempotencyKey} action={action}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Field label="Nominal (Rp)" htmlFor="amount" hint="Menambah saldo. Maksimal Rp 1.000.000.000 per top-up.">
        <input id="amount" name="amount" type="number" inputMode="numeric" min={1} max={1000000000} step={1} required aria-describedby="amount-hint" className={inputCls} />
      </Field>
      <Field label="Catatan" htmlFor="note" hint="Opsional, tersimpan di mutasi saldo (maks 200 karakter).">
        <input id="note" name="note" type="text" maxLength={200} aria-describedby="note-hint" className={inputCls} />
      </Field>
      <SubmitButton pendingText="Memproses…">Top-up saldo</SubmitButton>
      <p className="text-xs text-muted">Aman terhadap klik ganda: setiap form memakai kunci unik.</p>
    </ActionForm>
  );
}

export function UserFlagsForm({ action, userId, isActive, role, isSelf }: { action: Action; userId: string; isActive: boolean; role: string; isSelf: boolean }) {
  return (
    <ActionForm action={action} confirm="Simpan perubahan status/role akun ini?">
      <input type="hidden" name="userId" value={userId} />
      <Field label="Status akun" htmlFor="is_active" hint="Akun nonaktif tidak bisa membuat transaksi baru.">
        <select id="is_active" name="is_active" defaultValue={String(isActive)} disabled={isSelf} className={inputCls}>
          <option value="true">Aktif</option><option value="false">Nonaktif</option>
        </select>
      </Field>
      <Field label="Role" htmlFor="role">
        <select id="role" name="role" defaultValue={role} disabled={isSelf} className={inputCls}>
          <option value="user">User</option><option value="admin">Admin</option>
        </select>
      </Field>
      {isSelf ? <p className="text-xs text-muted">Admin tidak bisa mengubah akunnya sendiri.</p> : <SubmitButton variant="secondary">Simpan</SubmitButton>}
    </ActionForm>
  );
}

export function ProductForm({ action, p }: {
  action: Action;
  p: { id: string; margin: number; cost_price: number; is_active: boolean; display_name: string | null; display_category: string | null; sort_order: number; description: string | null; name: string; category: string | null };
}) {
  const [margin, setMargin] = useState(String(p.margin));
  const m = Number(margin);
  const sell = Number.isFinite(m) && m >= 0 ? p.cost_price + Math.trunc(m) : null;
  return (
    <ActionForm action={action}>
      <input type="hidden" name="productId" value={p.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Margin (Rp)" htmlFor="margin" hint={sell === null ? "Isi angka ≥ 0" : `Harga jual = modal ${p.cost_price.toLocaleString("id-ID")} + margin = Rp ${sell.toLocaleString("id-ID")}`}>
          <input id="margin" name="margin" type="number" inputMode="numeric" min={0} step={1} required value={margin} onChange={(e) => setMargin(e.target.value)} aria-describedby="margin-hint" className={inputCls} />
        </Field>
        <Field label="Dijual?" htmlFor="is_active" hint="Produk nonaktif tidak tampil di katalog.">
          <select id="is_active" name="is_active" defaultValue={String(p.is_active)} aria-describedby="is_active-hint" className={inputCls}>
            <option value="true">Aktif (tampil)</option><option value="false">Nonaktif (disembunyikan)</option>
          </select>
        </Field>
        <Field label="Nama tampilan" htmlFor="display_name" hint={`Kosongkan untuk memakai nama provider: “${p.name}”`}>
          <input id="display_name" name="display_name" maxLength={200} defaultValue={p.display_name ?? ""} aria-describedby="display_name-hint" className={inputCls} />
        </Field>
        <Field label="Kategori tampilan" htmlFor="display_category" hint={`Kosongkan untuk memakai kategori provider: “${p.category ?? "-"}”`}>
          <input id="display_category" name="display_category" maxLength={100} defaultValue={p.display_category ?? ""} aria-describedby="display_category-hint" className={inputCls} />
        </Field>
        <Field label="Urutan" htmlFor="sort_order" hint="Angka kecil tampil lebih dulu.">
          <input id="sort_order" name="sort_order" type="number" step={1} min={-100000} max={100000} defaultValue={p.sort_order} required aria-describedby="sort_order-hint" className={inputCls} />
        </Field>
      </div>
      <Field label="Deskripsi" htmlFor="description" hint="Tampil di halaman produk (maks 1000 karakter).">
        <textarea id="description" name="description" rows={3} maxLength={1000} defaultValue={p.description ?? ""} aria-describedby="description-hint" className={inputCls} />
      </Field>
      <SubmitButton block={false}>Simpan produk</SubmitButton>
    </ActionForm>
  );
}

export function BulkMarginForm({ action, categories }: { action: Action; categories: string[] }) {
  return (
    <ActionForm action={action} confirm="Terapkan margin ini ke SEMUA produk yang cocok dengan cakupan? Perubahan ini tercatat di audit.">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Mode" htmlFor="bm-mode">
          <select id="bm-mode" name="mode" defaultValue="PERCENT" className={inputCls}>
            <option value="PERCENT">Persen dari modal</option><option value="FLAT">Rupiah tetap</option>
          </select>
        </Field>
        <Field label="Nilai" htmlFor="bm-value" hint="Persen dibulatkan ke atas.">
          <input id="bm-value" name="value" type="number" min={0} step={1} required aria-describedby="bm-value-hint" className={inputCls} />
        </Field>
        <Field label="Kategori" htmlFor="bm-category" hint="Kosong = semua kategori.">
          <input id="bm-category" name="category" list="bm-cats" maxLength={100} aria-describedby="bm-category-hint" className={inputCls} />
          <datalist id="bm-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Cakupan" htmlFor="bm-active">
          <select id="bm-active" name="onlyActive" defaultValue="false" className={inputCls}>
            <option value="false">Semua produk</option><option value="true">Hanya yang aktif</option>
          </select>
        </Field>
      </div>
      <SubmitButton variant="secondary" block={false}>Terapkan margin massal</SubmitButton>
    </ActionForm>
  );
}

export function ResolveReviewForm({ action, reffId }: { action: Action; reffId: string }) {
  return (
    <ActionForm action={action}>
      <input type="hidden" name="reffId" value={reffId} />
      <Field label="Catatan penyelesaian" htmlFor="review-note" hint="Wajib (3–500 karakter). Hanya menutup tanda review; status & saldo tidak berubah.">
        <textarea id="review-note" name="note" rows={2} minLength={3} maxLength={500} required aria-describedby="review-note-hint" className={inputCls} />
      </Field>
      <SubmitButton variant="secondary" block={false}>Tutup tanda review</SubmitButton>
    </ActionForm>
  );
}

export function SendUnsentForm({ action, transactionId }: { action: Action; transactionId: string }) {
  return (
    <ActionForm action={action} confirm="Kirim transaksi ini ke provider sekarang? Hanya bisa dilakukan sekali.">
      <input type="hidden" name="transactionId" value={transactionId} />
      <p className="text-sm text-muted">Transaksi ini sudah memotong saldo tetapi belum pernah dikirim ke provider. Pengiriman memakai klaim atomik: tidak bisa terkirim dua kali.</p>
      <SubmitButton pendingText="Mengirim…" block={false}>Kirim ke provider</SubmitButton>
    </ActionForm>
  );
}

export function SettingsForm({ action, s }: {
  action: Action;
  s: {
    maintenance_mode: boolean; catalog_activate_new: boolean; catalog_default_margin: number; support_contact: string; announcement: string;
    topup_enabled: boolean; topup_min_amount: number; topup_max_amount: number; topup_code_min: number; topup_code_max: number; topup_expiry_minutes: number;
  };
}) {
  return (
    <ActionForm action={action} confirm="Simpan pengaturan? Mode pemeliharaan memblokir pembelian baru.">
      <Field label="Mode pemeliharaan" htmlFor="maintenance_mode" hint="Aktif = pembelian baru ditolak. Transaksi yang sudah berjalan tidak terpengaruh.">
        <select id="maintenance_mode" name="maintenance_mode" defaultValue={String(s.maintenance_mode)} aria-describedby="maintenance_mode-hint" className={inputCls}>
          <option value="false">Nonaktif</option><option value="true">Aktif (blokir pembelian)</option>
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Margin default produk baru (Rp)" htmlFor="catalog_default_margin" hint="Dipakai saat sinkronisasi katalog menemukan produk baru.">
          <input id="catalog_default_margin" name="catalog_default_margin" type="number" min={0} step={1} required defaultValue={s.catalog_default_margin} aria-describedby="catalog_default_margin-hint" className={inputCls} />
        </Field>
        <Field label="Produk baru langsung aktif?" htmlFor="catalog_activate_new" hint="Disarankan Tidak: periksa margin dulu.">
          <select id="catalog_activate_new" name="catalog_activate_new" defaultValue={String(s.catalog_activate_new)} aria-describedby="catalog_activate_new-hint" className={inputCls}>
            <option value="false">Tidak (nonaktif dulu)</option><option value="true">Ya</option>
          </select>
        </Field>
      </div>
      <fieldset className="space-y-4 rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold">Top-up otomatis</legend>
        <Field label="Top-up otomatis" htmlFor="topup_enabled" hint="Nyalakan hanya setelah rekening diisi dan pendeteksi uang masuk (atau konfirmasi manual admin) siap.">
          <select id="topup_enabled" name="topup_enabled" defaultValue={String(s.topup_enabled)} aria-describedby="topup_enabled-hint" className={inputCls}>
            <option value="false">Nonaktif</option><option value="true">Aktif</option>
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum top-up (Rp)" htmlFor="topup_min_amount"><input id="topup_min_amount" name="topup_min_amount" type="number" min={1} step={1} required defaultValue={s.topup_min_amount} className={inputCls} /></Field>
          <Field label="Maksimum top-up (Rp)" htmlFor="topup_max_amount"><input id="topup_max_amount" name="topup_max_amount" type="number" min={1} step={1} required defaultValue={s.topup_max_amount} className={inputCls} /></Field>
          <Field label="Kode unik minimum" htmlFor="topup_code_min" hint="Ditambahkan ke nominal."><input id="topup_code_min" name="topup_code_min" type="number" min={0} max={9999} step={1} required defaultValue={s.topup_code_min} aria-describedby="topup_code_min-hint" className={inputCls} /></Field>
          <Field label="Kode unik maksimum" htmlFor="topup_code_max" hint="Rentang lebih lebar = lebih banyak nominal bersamaan."><input id="topup_code_max" name="topup_code_max" type="number" min={0} max={9999} step={1} required defaultValue={s.topup_code_max} aria-describedby="topup_code_max-hint" className={inputCls} /></Field>
          <Field label="Masa berlaku (menit)" htmlFor="topup_expiry_minutes" hint="5 – 10080. Default 1440 = 24 jam."><input id="topup_expiry_minutes" name="topup_expiry_minutes" type="number" min={5} max={10080} step={1} required defaultValue={s.topup_expiry_minutes} aria-describedby="topup_expiry_minutes-hint" className={inputCls} /></Field>
        </div>
      </fieldset>
      <Field label="Kontak bantuan" htmlFor="support_contact" hint="Tampil saat pemeliharaan (maks 100 karakter).">
        <input id="support_contact" name="support_contact" maxLength={100} defaultValue={s.support_contact} aria-describedby="support_contact-hint" className={inputCls} />
      </Field>
      <Field label="Pengumuman" htmlFor="announcement" hint="Tampil di semua halaman user (maks 300 karakter). Kosongkan untuk menyembunyikan.">
        <textarea id="announcement" name="announcement" rows={2} maxLength={300} defaultValue={s.announcement} aria-describedby="announcement-hint" className={inputCls} />
      </Field>
      <SubmitButton block={false}>Simpan pengaturan</SubmitButton>
    </ActionForm>
  );
}

export function IntegrityCheck({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="space-y-2">
      <p className="text-sm text-muted">Membandingkan saldo setiap akun dengan jumlah mutasinya. Memindai seluruh ledger, jadi dijalankan manual.</p>
      <SubmitButton variant="secondary" pendingText="Memeriksa…" block={false}>Jalankan pengecekan integritas</SubmitButton>
    </ActionForm>
  );
}

export function ConfirmTopupForm({ action, requestId, label }: { action: Action; requestId: string; label: string }) {
  return (
    <ActionForm action={action} confirm={`Konfirmasi pembayaran ${label} dan tambahkan saldo user? Pastikan uangnya benar-benar sudah masuk ke rekening.`} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="min-w-48 flex-1"><Field label="Catatan (wajib)" htmlFor={`cn-${requestId}`}>
        <input id={`cn-${requestId}`} name="note" required minLength={3} maxLength={300} placeholder="mis. dicek di mutasi BRI" className={inputCls} /></Field></div>
      <SubmitButton variant="secondary" block={false} pendingText="Memproses…">Konfirmasi</SubmitButton>
    </ActionForm>
  );
}

export function ResolveTransferForm({ action, transferId, amountLabel }: { action: Action; transferId: string; amountLabel: string }) {
  const [mode, setMode] = useState<"CREDIT" | "IGNORE">("CREDIT");
  return (
    <ActionForm action={action} confirm={mode === "CREDIT" ? `Kreditkan ${amountLabel} ke user ini? Tindakan tercatat di audit.` : "Abaikan transfer ini?"}>
      <input type="hidden" name="transferId" value={transferId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Tindakan" htmlFor={`ra-${transferId}`}>
          <select id={`ra-${transferId}`} name="action" value={mode} onChange={(e) => setMode(e.target.value as "CREDIT" | "IGNORE")} className={inputCls}>
            <option value="CREDIT">Kreditkan ke user</option><option value="IGNORE">Abaikan</option>
          </select>
        </Field>
        <Field label="Email user" htmlFor={`re-${transferId}`} hint={mode === "CREDIT" ? "Harus persis sama dengan email akun." : "Tidak diperlukan."}>
          <input id={`re-${transferId}`} name="userEmail" type="email" disabled={mode === "IGNORE"} required={mode === "CREDIT"} aria-describedby={`re-${transferId}-hint`} className={inputCls} />
        </Field>
        <Field label="Catatan (wajib)" htmlFor={`rn-${transferId}`}>
          <input id={`rn-${transferId}`} name="note" required minLength={3} maxLength={300} className={inputCls} />
        </Field>
      </div>
      <SubmitButton variant="secondary" block={false} pendingText="Memproses…">Simpan</SubmitButton>
    </ActionForm>
  );
}

export function BankForm({ action, bank }: {
  action: Action;
  bank?: { code: string; bank_name: string; account_number: string; account_holder: string; is_active: boolean; sort_order: number };
}) {
  const k = bank?.code ?? "new";
  return (
    <ActionForm action={action} key={k}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kode bank" htmlFor={`bc-${k}`} hint="Huruf besar/angka, mis. BRI. Tidak bisa diubah setelah dibuat.">
          <input id={`bc-${k}`} name="code" required maxLength={10} defaultValue={bank?.code} readOnly={!!bank} aria-describedby={`bc-${k}-hint`} className={inputCls} />
        </Field>
        <Field label="Nama bank" htmlFor={`bn-${k}`}><input id={`bn-${k}`} name="bank_name" required maxLength={60} defaultValue={bank?.bank_name} className={inputCls} /></Field>
        <Field label="Nomor rekening" htmlFor={`ba-${k}`} hint="Hanya angka."><input id={`ba-${k}`} name="account_number" required inputMode="numeric" pattern="[0-9]{5,30}" defaultValue={bank?.account_number} aria-describedby={`ba-${k}-hint`} className={inputCls} /></Field>
        <Field label="Atas nama" htmlFor={`bh-${k}`}><input id={`bh-${k}`} name="account_holder" required maxLength={100} defaultValue={bank?.account_holder} className={inputCls} /></Field>
        <Field label="Aktif?" htmlFor={`bs-${k}`}>
          <select id={`bs-${k}`} name="is_active" defaultValue={String(bank?.is_active ?? false)} className={inputCls}><option value="false">Nonaktif</option><option value="true">Aktif (tampil di form top-up)</option></select>
        </Field>
        <Field label="Urutan" htmlFor={`bo-${k}`}><input id={`bo-${k}`} name="sort_order" type="number" step={1} required defaultValue={bank?.sort_order ?? 0} className={inputCls} /></Field>
      </div>
      <SubmitButton block={false}>{bank ? "Simpan rekening" : "Tambah rekening"}</SubmitButton>
    </ActionForm>
  );
}

export function InviteForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Untuk siapa? (catatan)" htmlFor="iv-note" hint="Opsional, hanya untuk kamu. Mis. nama calon reseller."><input id="iv-note" name="note" maxLength={100} aria-describedby="iv-note-hint" className={inputCls} /></Field>
        <Field label="Berlaku" htmlFor="iv-days">
          <select id="iv-days" name="validDays" defaultValue="7" className={inputCls}>
            <option value="1">1 hari</option><option value="3">3 hari</option><option value="7">7 hari</option><option value="14">14 hari</option><option value="30">30 hari</option>
          </select>
        </Field>
      </div>
      <SubmitButton block={false}>Buat kode undangan</SubmitButton>
    </ActionForm>
  );
}

export function RevokeInviteForm({ action, id }: { action: Action; id: string }) {
  return (
    <ActionForm action={action} className="inline" confirm="Cabut kode ini? Kode tidak bisa dipakai lagi.">
      <input type="hidden" name="id" value={id} />
      <SubmitButton block={false}>Cabut</SubmitButton>
    </ActionForm>
  );
}
