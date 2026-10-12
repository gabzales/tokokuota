import Link from "next/link";
import { notFound } from "next/navigation";
import { ResolveReviewForm, SendUnsentForm } from "@/components/AdminForms";
import { Badge, Card, linkCls, PageHeader, TableWrap, td, th } from "@/components/ui";
import { getTransactionById } from "@/lib/admin/queries";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { resolveReviewAction, sendUnsentAction } from "../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminTransactionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await getTransactionById(id);
  if (!data) notFound();
  const { tx, owner, ledger } = data;
  const canSend = tx.status === "PENDING" && tx.provider_attempts === 0;

  const rows: [string, React.ReactNode][] = [
    ["reff_id", <span key="r" className="break-all font-mono text-xs">{tx.reff_id}</span>],
    ["User", owner ? <Link key="u" className={linkCls} href={`/admin/users/${owner.id}`}>{owner.email}</Link> : "—"],
    ["Produk", `${tx.product_name} (${tx.provider_code})`],
    ["Tujuan", <span key="d" className="font-mono">{tx.destination}</span>],
    ["Harga jual", formatRupiah(tx.sell_price)],
    ["Harga modal", formatRupiah(tx.cost_price)],
    ["Margin", formatRupiah(tx.sell_price - tx.cost_price)],
    ["Dikirim ke provider", `${tx.provider_attempts}×${tx.provider_submitted_at ? ` (klaim ${formatDateTime(tx.provider_submitted_at)})` : ""}`],
    ["Rekonsiliasi terakhir", tx.last_reconciled_at ? formatDateTime(tx.last_reconciled_at) : "belum pernah"],
    ["Dibuat", formatDateTime(tx.created_at)],
    ["Selesai", tx.finalized_at ? formatDateTime(tx.finalized_at) : "—"],
  ];

  return (
    <>
      <Link href="/admin/transactions" className={`mb-3 inline-block text-sm ${linkCls}`}>← Semua transaksi</Link>
      <PageHeader title="Detail transaksi" actions={<div className="flex gap-2"><Badge kind={tx.status}>{tx.status}</Badge>{tx.needs_review && <Badge kind="REVIEW">perlu review</Badge>}</div>} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <dl className="divide-y divide-slate-100 text-sm">
            {rows.map(([k, v]) => (<div key={k} className="flex justify-between gap-4 py-2"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>))}
          </dl>
        </Card>
        <div className="space-y-4">
          {tx.status === "PENDING" && (
            <Card className="border-amber-200 bg-amber-50">
              <p className="text-sm text-amber-900"><strong>Tidak ada penyelesaian manual.</strong> Status SUCCESS/FAILED (dan refund) hanya berasal dari webhook yang valid atau rekonsiliasi (Tahap 2B).</p>
            </Card>
          )}
          {canSend && <Card><h2 className="mb-2 font-semibold">Kirim ke provider</h2><SendUnsentForm action={sendUnsentAction} transactionId={tx.id} /></Card>}
          {tx.needs_review && (
            <Card>
              <h2 className="mb-2 font-semibold">Tanda review</h2>
              {tx.review_note && <pre className="mb-3 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs">{tx.review_note}</pre>}
              <ResolveReviewForm action={resolveReviewAction} reffId={tx.reff_id} />
            </Card>
          )}
          {!tx.needs_review && tx.review_note && <Card><h2 className="mb-2 font-semibold">Riwayat review</h2><pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs">{tx.review_note}</pre></Card>}
        </div>
      </div>

      <h2 className="mb-2 mt-8 font-semibold">Mutasi saldo transaksi ini</h2>
      <TableWrap label="Mutasi transaksi">
        <thead><tr><th className={th}>Waktu</th><th className={th}>Jenis</th><th className={`${th} text-right`}>Jumlah</th><th className={`${th} text-right`}>Saldo akhir</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {ledger.map((l) => (
            <tr key={l.id}><td className={td}>{formatDateTime(l.created_at)}</td><td className={td}><Badge kind={l.type}>{l.type}</Badge></td>
              <td className={`${td} text-right tabular-nums`}>{formatRupiah(l.amount)}</td><td className={`${td} text-right tabular-nums`}>{formatRupiah(l.balance_after)}</td></tr>
          ))}
        </tbody>
      </TableWrap>

      <h2 className="mb-2 mt-8 font-semibold">Respons provider (audit, hanya server)</h2>
      <Card>
        {tx.provider_message && <p className="mb-2 text-sm">Pesan: {tx.provider_message}</p>}
        {tx.provider_raw ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(tx.provider_raw, null, 2)}</pre> : <p className="text-sm text-muted">Belum ada respons tercatat.</p>}
      </Card>
    </>
  );
}
