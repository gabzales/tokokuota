import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductForm } from "@/components/AdminForms";
import { Badge, Card, linkCls, PageHeader } from "@/components/ui";
import { getProductById } from "@/lib/admin/queries";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { updateProductAction } from "../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const p = await getProductById(id);
  if (!p) notFound();

  return (
    <>
      <Link href="/admin/products" className={`mb-3 inline-block text-sm ${linkCls}`}>← Semua produk</Link>
      <PageHeader title={p.display_name ?? p.name} description={`Kode provider ${p.provider_code}`}
        actions={<div className="flex gap-2"><Badge kind={p.is_active ? "ACTIVE" : "INACTIVE"}>{p.is_active ? "Aktif" : "Nonaktif"}</Badge>{!p.is_available && <Badge kind="WARN">stok provider kosong</Badge>}</div>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">Diatur oleh aplikasi</h2>
          <ProductForm action={updateProductAction} p={{
            id: p.id, margin: p.margin, cost_price: p.cost_price, is_active: p.is_active, display_name: p.display_name,
            display_category: p.display_category, sort_order: p.sort_order, description: p.description, name: p.name, category: p.category,
          }} />
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Data provider (hanya baca)</h2>
          <dl className="divide-y divide-slate-100 text-sm">
            {([["Nama", p.name], ["Kategori", p.category ?? "—"], ["Modal", formatRupiah(p.cost_price)], ["Harga jual", formatRupiah(p.sell_price)], ["Sinkron terakhir", formatDateTime(p.synced_at)]] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 py-2"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">Nama, kategori, dan modal diperbarui oleh sinkronisasi. Margin, status aktif, dan metadata tampilan tidak pernah ditimpa sinkronisasi.</p>
        </Card>
      </div>
    </>
  );
}
