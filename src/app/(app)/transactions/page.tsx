import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { requireUser } from "@/lib/auth/require-user";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Riwayat — Toko Kuota" };
const PAGE = 20;

interface TxRow { id: string; product_name: string; destination: string; sell_price: number; status: string; created_at: string }

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const supabase = await createServerSupabase();

  // Fetch one extra row to know if there is a next page (no count query).
  const { data } = await supabase
    .from("transactions")
    .select("id,product_name,destination,sell_price,status,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE);
  const all = (data ?? []) as TxRow[];
  const rows = all.slice(0, PAGE);

  return (
    <AppShell>
      <h1 className="text-xl font-semibold">Riwayat transaksi</h1>
      {rows.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-muted">Belum ada transaksi.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-surface">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={`/transactions/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.product_name}</p>
                  <p className="text-xs text-muted">{t.destination} · {formatDateTime(t.created_at)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{formatRupiah(t.sell_price)}</p>
                  <StatusBadge status={t.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-between text-sm">
        {page > 1 ? <Link className="text-primary" href={`/transactions?page=${page - 1}`}>← Lebih baru</Link> : <span />}
        {all.length > PAGE && <Link className="text-primary" href={`/transactions?page=${page + 1}`}>Lebih lama →</Link>}
      </div>
    </AppShell>
  );
}
