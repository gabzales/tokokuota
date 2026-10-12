import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { getCatalog } from "@/lib/catalog/cache";
import { categoriesOf, filterCatalog } from "@/lib/catalog/filter";
import { formatRupiah } from "@/lib/format";

export const metadata = { title: "Produk — Toko Kuota" };

type SP = { q?: string; category?: string; page?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const all = await getCatalog();
  const { items, page, total, hasNext } = filterCatalog(all, {
    q: sp.q?.slice(0, 80),
    category: sp.category,
    page: Number(sp.page) || 1,
  });
  const categories = categoriesOf(all);

  const qs = (over: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q, category: sp.category, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const s = p.toString();
    return s ? `/products?${s}` : "/products";
  };

  return (
    <AppShell>
      <h1 className="text-xl font-semibold">Produk</h1>
      <form className="mt-4 flex flex-wrap gap-2" action="/products">
        <input name="q" defaultValue={sp.q} placeholder="Cari produk…" maxLength={80}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary" />
        {categories.length > 0 && (
          <select name="category" defaultValue={sp.category ?? ""} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">Semua kategori</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white">Cari</button>
      </form>

      {items.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-muted">
          {all.length === 0 ? "Katalog belum tersedia." : "Produk tidak ditemukan."}
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <li key={p.id}>
              <Link href={`/products/${p.id}`} className="block h-full rounded-2xl border border-slate-200 bg-surface p-4 transition hover:border-primary/50 hover:shadow-sm">
                <p className="font-medium">{p.name}</p>
                {p.category && <p className="text-xs text-muted">{p.category}</p>}
                <p className="mt-3 text-lg font-bold text-primary">{formatRupiah(p.sell_price)}</p>
                {!p.is_available && <p className="mt-1 text-xs text-red-600">Sedang tidak tersedia</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex items-center justify-between text-sm text-muted">
        <span>{total} produk</span>
        <div className="flex gap-3">
          {page > 1 && <Link className="text-primary" href={qs({ page: String(page - 1) })}>← Sebelumnya</Link>}
          {hasNext && <Link className="text-primary" href={qs({ page: String(page + 1) })}>Berikutnya →</Link>}
        </div>
      </div>
    </AppShell>
  );
}
