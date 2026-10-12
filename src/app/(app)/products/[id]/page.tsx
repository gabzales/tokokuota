import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CheckoutForm } from "@/components/CheckoutForm";
import { getCatalog } from "@/lib/catalog/cache";
import { formatRupiah } from "@/lib/format";
import { checkoutAction } from "./actions";

// Checkout calls the provider (up to KHFYPAY_TIMEOUT_MS) inside the server action.
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  // Served from the cached catalogue: no extra database read for the detail page.
  const product = (await getCatalog()).find((p) => p.id === id);
  if (!product) notFound();

  return (
    <AppShell>
      <Link href="/products" className="text-sm text-muted hover:text-ink">← Semua produk</Link>
      <div className="mt-3 grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-surface p-6">
          <h1 className="text-xl font-semibold">{product.name}</h1>
          {product.category && <p className="text-sm text-muted">{product.category}</p>}
          <p className="mt-4 text-3xl font-bold text-primary">{formatRupiah(product.sell_price)}</p>
          {product.description && <p className="mt-4 whitespace-pre-line text-sm text-muted">{product.description}</p>}
        </section>
        <section className="rounded-2xl border border-slate-200 bg-surface p-6">
          <h2 className="mb-4 font-semibold">Checkout</h2>
          <CheckoutForm
            action={checkoutAction}
            productId={product.id}
            // One key per rendered form: re-submitting the same form can never buy twice.
            idempotencyKey={randomUUID()}
            expectedPrice={product.sell_price}
            priceLabel={formatRupiah(product.sell_price)}
            disabled={!product.is_available}
          />
        </section>
      </div>
    </AppShell>
  );
}
