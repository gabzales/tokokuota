import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { getProfile, requireUser } from "@/lib/auth/require-user";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Dashboard — Toko Kuota" };

interface TxRow { id: string; product_name: string; destination: string; sell_price: number; status: string; created_at: string }

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createServerSupabase();

  const [profile, recent, pending] = await Promise.all([
    getProfile(),
    supabase
      .from("transactions")
      .select("id,product_name,destination,sell_price,status,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "PENDING"),
  ]);
  const rows = (recent.data ?? []) as TxRow[];

  return (
    <AppShell>
      <h1 className="text-xl font-semibold">Halo{profile?.full_name ? `, ${profile.full_name}` : ""}</h1>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-gradient-to-br from-primary to-secondary p-5 text-white">
          <p className="text-sm opacity-90">Saldo</p>
          <p className="mt-1 text-2xl font-bold">{formatRupiah(profile?.saldo ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-surface p-5">
          <p className="text-sm text-muted">Transaksi diproses</p>
          <p className="mt-1 text-2xl font-bold">{pending.count ?? 0}</p>
        </div>
        <Link href="/topup" className="flex items-center justify-center rounded-2xl border border-secondary/30 bg-secondary/5 p-5 font-medium text-secondary hover:bg-secondary/10">
          Top-up saldo →
        </Link>
        <Link href="/products" className="flex items-center justify-center rounded-2xl border border-primary/30 bg-primary/5 p-5 font-medium text-primary hover:bg-primary/10">
          Beli produk →
        </Link>
      </div>

      <h2 className="mt-8 mb-3 font-semibold">Transaksi terakhir</h2>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-muted">Belum ada transaksi.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-surface">
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
    </AppShell>
  );
}
