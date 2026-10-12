import { IntegrityCheck } from "@/components/AdminForms";
import { Card, PageHeader, StatCard } from "@/components/ui";
import { getDashboardStats } from "@/lib/admin/queries";
import { startOfTodayJakarta } from "@/lib/admin/list-params";
import { formatRupiah } from "@/lib/format";
import { integrityCheckAction } from "./actions";

export const metadata = { title: "Ringkasan — Admin" };

export default async function AdminHome() {
  const s = await getDashboardStats(startOfTodayJakarta());
  const attention = s.unsent + s.stale_pending + s.needs_review + s.topup_queued;

  return (
    <>
      <PageHeader title="Ringkasan" description="Angka hari ini (zona waktu Asia/Jakarta) dan hal yang perlu perhatian." />

      <h2 className="mb-2 text-sm font-semibold text-muted">Perlu perhatian</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Ditandai review" value={s.needs_review} tone={s.needs_review ? "danger" : "default"} href="/admin/transactions?view=review" hint="Sinyal yang saling bertentangan / error kirim" />
        <StatCard label="Belum terkirim" value={s.unsent} tone={s.unsent ? "warn" : "default"} href="/admin/transactions?view=unsent" hint="Saldo terpotong, belum ke provider (>2 mnt)" />
        <StatCard label="PENDING lama" value={s.stale_pending} tone={s.stale_pending ? "warn" : "default"} href="/admin/transactions?view=stale" hint="Sudah dikirim, belum ada kabar (>10 mnt)" />
        <StatCard label="Webhook belum terselesaikan" value={s.webhook_unresolved_24h} tone={s.webhook_unresolved_24h ? "warn" : "default"} href="/admin/monitoring" hint="24 jam terakhir" />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Transfer top-up perlu dicek" value={s.topup_queued} tone={s.topup_queued ? "warn" : "default"} href="/admin/topups?view=queue" hint="Telat, nominal tidak cocok, dll." />
        <StatCard label="Top-up menunggu bayar" value={s.topup_pending} href="/admin/topups" hint="Belum kedaluwarsa" />
      </div>
      {attention === 0 && <p className="mt-3 text-sm text-emerald-700">Tidak ada transaksi yang perlu ditangani manual.</p>}

      <h2 className="mb-2 mt-8 text-sm font-semibold text-muted">Hari ini</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Berhasil" value={s.since_success} />
        <StatCard label="Diproses" value={s.since_pending} />
        <StatCard label="Gagal" value={s.since_failed} />
        <StatCard label="Omzet / laba (berhasil)" value={formatRupiah(s.since_revenue)} hint={`Laba ${formatRupiah(s.since_profit)}`} tone="brand" />
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold text-muted">Keseluruhan</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="User" value={s.users_total} hint={`${s.users_active} aktif`} href="/admin/users" />
        <StatCard label="Total saldo user" value={formatRupiah(s.saldo_total)} href="/admin/ledger" />
        <StatCard label="Transaksi PENDING" value={s.pending_total} href="/admin/transactions?status=PENDING" />
      </div>

      <Card className="mt-8">
        <h2 className="mb-2 font-semibold">Integritas saldo</h2>
        <IntegrityCheck action={integrityCheckAction} />
      </Card>
    </>
  );
}
