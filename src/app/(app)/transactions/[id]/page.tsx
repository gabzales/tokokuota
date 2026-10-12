import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { StatusBadge } from "@/components/StatusBadge";
import { requireUser } from "@/lib/auth/require-user";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Tx {
  id: string; product_name: string; destination: string; sell_price: number; status: string;
  provider_message: string | null; created_at: string; finalized_at: string | null;
}

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser();
  const supabase = await createServerSupabase();

  // RLS already limits rows to the owner; the explicit user_id filter is belt and braces.
  const { data } = await supabase
    .from("transactions")
    .select("id,product_name,destination,sell_price,status,provider_message,created_at,finalized_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  const tx = data as Tx | null;
  if (!tx) notFound();

  const rows: [string, string][] = [
    ["ID transaksi", tx.id],
    ["Tujuan", tx.destination],
    ["Harga", formatRupiah(tx.sell_price)],
    ["Dibuat", formatDateTime(tx.created_at)],
    ...(tx.finalized_at ? ([["Selesai", formatDateTime(tx.finalized_at)]] as [string, string][]) : []),
  ];

  return (
    <AppShell>
      {tx.status === "PENDING" && <AutoRefresh />}
      <Link href="/transactions" className="text-sm text-muted hover:text-ink">← Riwayat</Link>
      <section className="mt-3 max-w-xl rounded-2xl border border-slate-200 bg-surface p-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-semibold">{tx.product_name}</h1>
          <StatusBadge status={tx.status} />
        </div>

        {tx.status === "PENDING" && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Transaksi sedang diproses. Halaman ini diperbarui otomatis. Saldo dikembalikan otomatis jika transaksi gagal.
          </p>
        )}
        {tx.status === "FAILED" && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Transaksi gagal. Saldo sudah dikembalikan.</p>
        )}
        {tx.status === "SUCCESS" && (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Transaksi berhasil.</p>
        )}

        <dl className="mt-4 divide-y divide-slate-100 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2">
              <dt className="text-muted">{k}</dt>
              <dd className="break-all text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {tx.provider_message && <p className="mt-3 text-sm text-muted">Keterangan: {tx.provider_message}</p>}
      </section>
    </AppShell>
  );
}
