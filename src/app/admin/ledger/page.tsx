import Link from "next/link";
import { ExportForm } from "@/components/ExportForm";
import { Badge, btnSecondary, EmptyState, FilterForm, inputCls, linkCls, PageHeader, Pagination, TableWrap, td, th } from "@/components/ui";
import { pageSlice, parseLedgerFilters, withParams } from "@/lib/admin/list-params";
import { listLedger } from "@/lib/admin/queries";
import { formatDateTime, formatRupiah } from "@/lib/format";

export const metadata = { title: "Mutasi Saldo — Admin" };

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseLedgerFilters(await searchParams);
  const { rows, hasNext } = pageSlice(await listLedger(f));

  return (
    <>
      <PageHeader title="Mutasi Saldo" description="Catatan setiap perubahan saldo. Hanya tambah, tidak bisa diubah atau dihapus." />
      <ExportForm kind="ledger" options={{ name: "type", label: "Jenis", values: ["PURCHASE", "REFUND", "MANUAL_TOPUP", "TOPUP", "ADJUSTMENT"] }} />
      <FilterForm action="/admin/ledger">
        <label className="min-w-0 flex-1"><span className="sr-only">Cari email atau catatan</span>
          <input name="q" defaultValue={f.q} placeholder="Email user / catatan…" maxLength={80} className={inputCls} /></label>
        <label><span className="sr-only">Jenis</span>
          <select name="type" defaultValue={f.type ?? ""} className={inputCls}><option value="">Semua jenis</option>{["PURCHASE", "REFUND", "MANUAL_TOPUP", "ADJUSTMENT"].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        {f.user && <input type="hidden" name="user" value={f.user} />}
        <button className={btnSecondary}>Terapkan</button>
      </FilterForm>
      {f.user && <p className="mb-3 text-sm text-muted">Disaring untuk satu user. <Link className={linkCls} href={withParams("/admin/ledger", f, { user: undefined, page: 1 })}>Hapus filter user</Link></p>}

      {rows.length === 0 ? <EmptyState title="Tidak ada mutasi" hint="Ubah filter atau kata kunci." /> : (
        <TableWrap label="Mutasi saldo">
          <thead><tr><th className={th}>Waktu</th><th className={th}>User</th><th className={th}>Jenis</th><th className={`${th} text-right`}>Jumlah</th><th className={`${th} text-right`}>Sebelum</th><th className={`${th} text-right`}>Sesudah</th><th className={th}>Catatan</th><th className={th} /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((l) => (
              <tr key={l.id}>
                <td className={td}>{formatDateTime(l.created_at)}</td>
                <td className={`${td} max-w-40 truncate`}><Link className={linkCls} href={`/admin/users/${l.user_id}`}>{l.user_email}</Link></td>
                <td className={td}><Badge kind={l.type}>{l.type}</Badge></td>
                <td className={`${td} text-right tabular-nums ${l.amount < 0 ? "text-red-700" : "text-emerald-700"}`}>{l.amount > 0 ? "+" : ""}{formatRupiah(l.amount)}</td>
                <td className={`${td} text-right tabular-nums text-muted`}>{formatRupiah(l.balance_before)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatRupiah(l.balance_after)}</td>
                <td className={`${td} max-w-xs break-words text-xs text-muted`}>{l.note}{l.created_by_email && <span className="block">oleh {l.created_by_email}</span>}</td>
                <td className={td}>{l.transaction_id && <Link className={linkCls} href={`/admin/transactions/${l.transaction_id}`}>Transaksi</Link>}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Pagination page={f.page} hasNext={hasNext} hrefFor={(p) => withParams("/admin/ledger", f, { page: p })} />
    </>
  );
}
