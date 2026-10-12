import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CreateTopupForm } from "@/components/TopupForms";
import { Badge, Card, EmptyState, linkCls, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/require-user";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { getTopupSettings } from "@/lib/settings/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getActiveBankChoices } from "@/lib/topup/banks";
import { createTopupAction } from "./actions";

export const metadata = { title: "Top-up saldo — Toko Kuota" };

interface Row { id: string; bank_code: string; total_amount: number; status: string; expires_at: string; created_at: string }

export default async function TopupPage() {
  const user = await requireUser();
  const [settings, banks] = await Promise.all([getTopupSettings(), getActiveBankChoices()]);
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("topup_requests").select("id,bank_code,total_amount,status,expires_at,created_at")
    .eq("user_id", user.id).order("created_at", { ascending: false }).limit(10);
  const rows = (data ?? []) as Row[];
  const available = settings.enabled && banks.length > 0;

  return (
    <AppShell>
      <PageHeader title="Top-up saldo" description="Transfer bank dengan nominal unik. Saldo masuk otomatis setelah transfer terdeteksi." />
      {available ? (
        <Card className="max-w-md">
          <CreateTopupForm action={createTopupAction} banks={banks} idempotencyKey={crypto.randomUUID()} min={settings.min} max={settings.max} />
        </Card>
      ) : (
        <EmptyState title="Top-up otomatis belum tersedia" hint="Hubungi admin untuk top-up manual." />
      )}

      <h2 className="mb-2 mt-8 font-semibold">Permintaan terakhir</h2>
      {rows.length === 0 ? <EmptyState title="Belum ada permintaan top-up" /> : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-surface">
          {rows.map((r) => {
            const effective = r.status === "PENDING" && new Date(r.expires_at).getTime() < Date.now() ? "EXPIRED" : r.status;
            return (
              <li key={r.id}>
                <Link href={`/topup/${r.id}`} className={`flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 ${linkCls}`}>
                  <div>
                    <p className="font-medium tabular-nums text-ink">{formatRupiah(r.total_amount)}</p>
                    <p className="text-xs text-muted">{r.bank_code} · {formatDateTime(r.created_at)}</p>
                  </div>
                  <Badge kind={effective}>{effective === "PENDING" ? "Menunggu" : effective === "PAID" ? "Berhasil" : effective === "EXPIRED" ? "Kedaluwarsa" : "Dibatalkan"}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
