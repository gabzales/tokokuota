import Link from "next/link";
import { ExportForm } from "@/components/ExportForm";
import { Badge, btnSecondary, EmptyState, FilterForm, inputCls, linkCls, PageHeader, Pagination, TableWrap, td, th } from "@/components/ui";
import { pageSlice, parseTxFilters, withParams } from "@/lib/admin/list-params";
import { listTransactions } from "@/lib/admin/queries";
import { formatDateTime, formatRupiah } from "@/lib/format";

export const metadata = { title: "Transaksi — Admin" };

const VIEWS = { review: "Ditandai review", unsent: "Belum terkirim", stale: "PENDING lama" } as const;

export default async function TransactionsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseTxFilters(await searchParams);
  const { rows, hasNext } = pageSlice(await listTransactions(f));

  return (
    <>
      <PageHeader title="Transaksi" description={f.view ? `Tampilan: ${VIEWS[f.view]}` : "Cari tujuan, produk, reff_id, atau email user."} />
      <ExportForm kind="transactions" options={{ name: "status", label: "Status", values: ["PENDING", "SUCCESS", "FAILED"] }} />
      <FilterForm action="/admin/transactions">
        <label className="min-w-0 flex-1"><span className="sr-only">Cari</span>
          <input name="q" defaultValue={f.q} placeholder="Tujuan / produk / reff_id / email…" maxLength={80} className={inputCls} /></label>
        <label><span className="sr-only">Status</span>
          <select name="status" defaultValue={f.status ?? ""} className={inputCls}><option value="">Semua status</option><option value="PENDING">PENDING</option><option value="SUCCESS">SUCCESS</option><option value="FAILED">FAILED</option></select></label>
        <label><span className="sr-only">Tampilan</span>
          <select name="view" defaultValue={f.view ?? ""} className={inputCls}><option value="">Semua</option>{Object.entries(VIEWS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {f.user && <input type="hidden" name="user" value={f.user} />}
        <button className={btnSecondary}>Terapkan</button>
      </FilterForm>

      {rows.length === 0 ? <EmptyState title="Tidak ada transaksi" hint="Ubah filter atau kata kunci." /> : (
        <TableWrap label="Daftar transaksi">
          <thead><tr><th className={th}>Waktu</th><th className={th}>User</th><th className={th}>Produk</th><th className={th}>Tujuan</th><th className={`${th} text-right`}>Harga</th><th className={th}>Status</th><th className={th}>Kirim</th><th className={th} /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((t) => (
              <tr key={t.id}>
                <td className={td}>{formatDateTime(t.created_at)}</td>
                <td className={`${td} max-w-40 truncate`}>{t.user_email}</td>
                <td className={td}>{t.product_name}</td>
                <td className={`${td} font-mono text-xs`}>{t.destination}</td>
                <td className={`${td} text-right tabular-nums`}>{formatRupiah(t.sell_price)}</td>
                <td className={td}><div className="flex flex-wrap gap-1"><Badge kind={t.status}>{t.status}</Badge>{t.needs_review && <Badge kind="REVIEW">review</Badge>}</div></td>
                <td className={td}>{t.provider_attempts}×</td>
                <td className={td}><Link className={linkCls} href={`/admin/transactions/${t.id}`}>Detail</Link></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Pagination page={f.page} hasNext={hasNext} hrefFor={(p) => withParams("/admin/transactions", f, { page: p })} />
    </>
  );
}
