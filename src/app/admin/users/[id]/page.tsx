import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TopupForm, UserFlagsForm } from "@/components/AdminForms";
import { Badge, Card, EmptyState, linkCls, PageHeader, TableWrap, td, th } from "@/components/ui";
import { getAdmin } from "@/lib/admin/auth";
import { getUserById, listLedger, listTransactions } from "@/lib/admin/queries";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { setUserFlagsAction, topupAction } from "../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [user, admin] = await Promise.all([getUserById(id), getAdmin()]);
  if (!user) notFound();
  const [txs, ledger] = await Promise.all([
    listTransactions({ user: id, page: 1, limit: 10 }),
    listLedger({ user: id, page: 1 }),
  ]);

  return (
    <>
      <Link href="/admin/users" className={`mb-3 inline-block text-sm ${linkCls}`}>← Semua user</Link>
      <PageHeader title={user.full_name || user.email || "User"} description={user.email ?? undefined}
        actions={<div className="flex gap-2"><Badge kind={user.role.toUpperCase()}>{user.role}</Badge><Badge kind={user.is_active ? "ACTIVE" : "INACTIVE"}>{user.is_active ? "Aktif" : "Nonaktif"}</Badge></div>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Saldo</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{formatRupiah(user.saldo)}</p>
          <p className="mt-1 text-xs text-muted">Terdaftar {formatDateTime(user.created_at)}</p>
          <p className="mt-1 break-all font-mono text-[11px] text-muted">{user.id}</p>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Top-up manual</h2>
          <TopupForm action={topupAction} userId={user.id} idempotencyKey={randomUUID()} />
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Akun</h2>
          <UserFlagsForm action={setUserFlagsAction} userId={user.id} isActive={user.is_active} role={user.role} isSelf={admin?.id === user.id} />
        </Card>
      </div>

      <h2 className="mb-2 mt-8 font-semibold">Transaksi terakhir</h2>
      {txs.length === 0 ? <EmptyState title="Belum ada transaksi" /> : (
        <TableWrap label="Transaksi user">
          <thead><tr><th className={th}>Waktu</th><th className={th}>Produk</th><th className={th}>Tujuan</th><th className={th}>Harga</th><th className={th}>Status</th><th className={th} /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {txs.slice(0, 10).map((t) => (
              <tr key={t.id}>
                <td className={td}>{formatDateTime(t.created_at)}</td><td className={td}>{t.product_name}</td>
                <td className={`${td} font-mono text-xs`}>{t.destination}</td><td className={`${td} tabular-nums`}>{formatRupiah(t.sell_price)}</td>
                <td className={td}><Badge kind={t.status}>{t.status}</Badge></td>
                <td className={td}><Link className={linkCls} href={`/admin/transactions/${t.id}`}>Detail</Link></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <div className="mb-2 mt-8 flex items-center justify-between"><h2 className="font-semibold">Mutasi saldo terakhir</h2><Link className={`text-sm ${linkCls}`} href={`/admin/ledger?user=${id}`}>Semua mutasi →</Link></div>
      {ledger.length === 0 ? <EmptyState title="Belum ada mutasi" /> : (
        <TableWrap label="Mutasi saldo user">
          <thead><tr><th className={th}>Waktu</th><th className={th}>Jenis</th><th className={`${th} text-right`}>Jumlah</th><th className={`${th} text-right`}>Saldo akhir</th><th className={th}>Catatan</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {ledger.slice(0, 10).map((l) => (
              <tr key={l.id}>
                <td className={td}>{formatDateTime(l.created_at)}</td><td className={td}><Badge kind={l.type}>{l.type}</Badge></td>
                <td className={`${td} text-right tabular-nums ${l.amount < 0 ? "text-red-700" : "text-emerald-700"}`}>{l.amount > 0 ? "+" : ""}{formatRupiah(l.amount)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatRupiah(l.balance_after)}</td><td className={`${td} max-w-xs break-words text-xs text-muted`}>{l.note}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}
