import Link from "next/link";
import { Badge, Card, EmptyState, linkCls, PageHeader, TableWrap, td, th } from "@/components/ui";
import { listTransactions, listWebhookEvents, type TxRow } from "@/lib/admin/queries";
import { formatDateTime, formatRupiah } from "@/lib/format";

export const metadata = { title: "Monitoring — Admin" };

function TxTable({ rows, label }: { rows: TxRow[]; label: string }) {
  return (
    <TableWrap label={label}>
      <thead><tr><th className={th}>Waktu</th><th className={th}>User</th><th className={th}>Produk</th><th className={th}>Tujuan</th><th className={th}>Harga</th><th className={th}>Kirim</th><th className={th} /></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((t) => (
          <tr key={t.id}>
            <td className={td}>{formatDateTime(t.created_at)}</td>
            <td className={`${td} max-w-40 truncate`}>{t.user_email}</td>
            <td className={td}>{t.product_name}</td>
            <td className={`${td} font-mono text-xs`}>{t.destination}</td>
            <td className={`${td} tabular-nums`}>{formatRupiah(t.sell_price)}</td>
            <td className={td}>{t.provider_attempts}×</td>
            <td className={td}><Link className={linkCls} href={`/admin/transactions/${t.id}`}>Detail</Link></td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export default async function MonitoringPage() {
  const [review, unsent, stale, events] = await Promise.all([
    listTransactions({ view: "review", page: 1, limit: 20 }),
    listTransactions({ view: "unsent", page: 1, limit: 20 }),
    listTransactions({ view: "stale", page: 1, limit: 20 }),
    listWebhookEvents({ unresolved: true, page: 1, limit: 20 }),
  ]);

  return (
    <>
      <PageHeader title="Monitoring" description="Antrian yang perlu dilihat manusia. Tidak ada refund otomatis: transaksi PENDING tetap PENDING sampai ada konfirmasi yang valid." />
      <div className="space-y-8">
        <section aria-labelledby="h-review">
          <h2 id="h-review" className="mb-2 flex items-center gap-2 font-semibold">Ditandai review <Badge kind="REVIEW">{review.length}</Badge></h2>
          {review.length === 0 ? <EmptyState title="Tidak ada yang ditandai" /> : <TxTable rows={review} label="Transaksi ditandai review" />}
        </section>
        <section aria-labelledby="h-unsent">
          <h2 id="h-unsent" className="mb-2 flex items-center gap-2 font-semibold">Belum terkirim ke provider <Badge kind="WARN">{unsent.length}</Badge></h2>
          <p className="mb-2 text-sm text-muted">Saldo sudah terpotong tetapi /trx belum pernah dikirim (misal server mati setelah reservasi). Buka detail untuk mengirim dengan klaim atomik.</p>
          {unsent.length === 0 ? <EmptyState title="Semua transaksi sudah ditangani" /> : <TxTable rows={unsent} label="Transaksi belum terkirim" />}
        </section>
        <section aria-labelledby="h-stale">
          <h2 id="h-stale" className="mb-2 flex items-center gap-2 font-semibold">PENDING lama <Badge kind="WARN">{stale.length}</Badge></h2>
          <p className="mb-2 text-sm text-muted">Sudah dikirim, belum ada kabar &gt; 10 menit. Konfirmasi lewat webhook / /history (Tahap 2B). Belum ada penyelesaian manual.</p>
          {stale.length === 0 ? <EmptyState title="Tidak ada PENDING yang menggantung" /> : <TxTable rows={stale} label="Transaksi PENDING lama" />}
        </section>
        <Card>
          <h2 className="mb-2 font-semibold">Webhook belum terselesaikan</h2>
          {events.length === 0 ? <EmptyState title="Belum ada callback yang menggantung" hint="Callback tercatat, tetapi status sukses/gagalnya belum bisa dibaca sampai contoh pesan provider tersedia." /> : (
            <TableWrap label="Webhook">
              <thead><tr><th className={th}>Terakhir</th><th className={th}>reff_id</th><th className={th}>Hasil</th><th className={th}>Diterima</th><th className={th}>Pesan</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className={td}>{formatDateTime(e.last_received_at)}</td>
                    <td className={`${td} font-mono text-xs`}>{e.reff_id ?? "—"}</td>
                    <td className={td}><Badge kind="WARN">{e.outcome ?? "belum diproses"}</Badge></td>
                    <td className={td}>{e.receive_count}×</td>
                    <td className={`${td} max-w-xs break-all text-xs text-muted`}>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
