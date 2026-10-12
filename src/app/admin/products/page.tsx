import Link from "next/link";
import { BulkMarginForm } from "@/components/AdminForms";
import { Badge, btnSecondary, Card, EmptyState, FilterForm, inputCls, linkCls, PageHeader, Pagination, TableWrap, td, th } from "@/components/ui";
import { pageSlice, parseProductFilters, withParams } from "@/lib/admin/list-params";
import { listProducts } from "@/lib/admin/queries";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { bulkMarginAction } from "../actions";

export const metadata = { title: "Produk & Margin — Admin" };

export default async function ProductsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseProductFilters(await searchParams);
  const { rows, hasNext } = pageSlice(await listProducts(f));
  const categories = [...new Set(rows.map((r) => r.display_category ?? r.category).filter((c): c is string => !!c))].sort();

  return (
    <>
      <PageHeader title="Produk & Margin" description="Margin, status tampil, dan metadata tampilan dikelola di sini. Sinkronisasi provider TIDAK menimpa margin, status aktif, maupun metadata tampilan." />

      <Card className="mb-5">
        <h2 className="mb-3 font-semibold">Margin massal</h2>
        <BulkMarginForm action={bulkMarginAction} categories={categories} />
      </Card>

      <FilterForm action="/admin/products">
        <label className="min-w-0 flex-1"><span className="sr-only">Cari produk</span>
          <input name="q" defaultValue={f.q} placeholder="Nama / kode provider…" maxLength={80} className={inputCls} /></label>
        <label><span className="sr-only">Kategori</span>
          <input name="category" defaultValue={f.category} placeholder="Kategori" maxLength={80} className={inputCls} /></label>
        <label><span className="sr-only">Status</span>
          <select name="active" defaultValue={f.active === undefined ? "" : String(f.active)} className={inputCls}><option value="">Semua</option><option value="true">Aktif</option><option value="false">Nonaktif</option></select></label>
        <button className={btnSecondary}>Terapkan</button>
      </FilterForm>

      {rows.length === 0 ? (
        <EmptyState title="Belum ada produk" hint="Katalog terisi lewat sinkronisasi /list_product. Itu menunggu contoh JSON asli dari provider (parser belum diaktifkan)." />
      ) : (
        <TableWrap label="Daftar produk">
          <thead><tr><th className={th}>Produk</th><th className={th}>Kode</th><th className={`${th} text-right`}>Modal</th><th className={`${th} text-right`}>Margin</th><th className={`${th} text-right`}>Jual</th><th className={th}>Status</th><th className={th}>Sinkron</th><th className={th} /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => (
              <tr key={p.id}>
                <td className={td}><p className="font-medium">{p.display_name ?? p.name}</p><p className="text-xs text-muted">{p.display_category ?? p.category ?? "—"}</p></td>
                <td className={`${td} font-mono text-xs`}>{p.provider_code}</td>
                <td className={`${td} text-right tabular-nums`}>{formatRupiah(p.cost_price)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatRupiah(p.margin)}</td>
                <td className={`${td} text-right font-medium tabular-nums`}>{formatRupiah(p.sell_price)}</td>
                <td className={td}><div className="flex flex-wrap gap-1"><Badge kind={p.is_active ? "ACTIVE" : "INACTIVE"}>{p.is_active ? "Aktif" : "Nonaktif"}</Badge>{!p.is_available && <Badge kind="WARN">stok provider kosong</Badge>}</div></td>
                <td className={`${td} text-xs text-muted`}>{formatDateTime(p.synced_at)}</td>
                <td className={td}><Link className={linkCls} href={`/admin/products/${p.id}`}>Edit</Link></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Pagination page={f.page} hasNext={hasNext} hrefFor={(p) => withParams("/admin/products", f, { page: p })} />
    </>
  );
}
