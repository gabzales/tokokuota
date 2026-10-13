import { headers } from "next/headers";
import { DiagnosticsPanel } from "@/components/DiagnosticsPanel";
import { Card, EmptyState, PageHeader, TableWrap, td, th } from "@/components/ui";
import { listDiagLogs, listWebhookPayloads } from "@/lib/admin/queries";
import { runEnvCheck } from "@/lib/diagnostics/run";
import { formatDateTime } from "@/lib/format";
import { runDiagnosticAction } from "./actions";

export const metadata = { title: "Diagnostik — Admin" };
export const dynamic = "force-dynamic";

const STATUS_CLS: Record<string, string> = { pass: "text-emerald-700", warn: "text-amber-700", fail: "text-red-700", skip: "text-slate-500" };

const preview = (v: unknown, max = 160) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

export default async function DiagnosticsPage() {
  const h = await headers();
  const site = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const [logs, events] = await Promise.all([listDiagLogs().catch(() => null), listWebhookPayloads().catch(() => null)]);
  return (
    <>
      <PageHeader title="Diagnostik" description="Tes koneksi langsung dari web: konfigurasi, Supabase, KhfyPay, dan webhook. Setiap hasil punya kode error, saran perbaikan, dan detail mentah yang bisa disalin." />
      <DiagnosticsPanel initial={runEnvCheck()} run={runDiagnosticAction} site={site} />

      <h2 className="mb-2 mt-8 font-semibold">Log tes terakhir</h2>
      {logs === null ? (
        <Card><p className="text-sm text-muted">Log belum aktif: jalankan migrasi 0009 (supabase/migrations/0009_diagnostics.sql). Tesnya sendiri tetap berfungsi, dan hasilnya juga tercatat di Vercel → Logs.</p></Card>
      ) : logs.length === 0 ? (
        <EmptyState title="Belum ada log" hint="Jalankan tes di atas, hasilnya akan tercatat di sini." />
      ) : (
        <TableWrap label="Log tes">
          <thead><tr><th className={th}>Waktu</th><th className={th}>Tes</th><th className={th}>Hasil</th><th className={th}>Kode</th><th className={th}>HTTP</th><th className={th}>ms</th><th className={th}>Ringkasan</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((l) => (
              <tr key={l.id}>
                <td className={`${td} whitespace-nowrap text-xs`}>{formatDateTime(l.created_at)}</td>
                <td className={`${td} font-mono text-xs`}>{l.check_id}</td>
                <td className={`${td} font-semibold uppercase ${STATUS_CLS[l.status] ?? ""}`}>{l.status}</td>
                <td className={`${td} font-mono text-xs`}>{l.code}</td>
                <td className={td}>{l.http_status ?? "—"}</td>
                <td className={td}>{l.latency_ms ?? "—"}</td>
                <td className={`${td} max-w-md text-xs`}>{l.summary}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <h2 className="mb-2 mt-8 font-semibold">Pesan webhook terakhir dari KhfyPay</h2>
      <p className="mb-2 text-sm text-muted">Isi mentah pesan yang masuk. Ini bahan untuk membuat parser status (kirim satu contoh sukses dan satu gagal ke Claude). Pesan berawalan DIAG-TES adalah dari tes di atas.</p>
      {events === null ? (
        <Card><p className="text-sm text-muted">Tabel pesan webhook tidak bisa dibaca. Jalankan tes Supabase di atas.</p></Card>
      ) : events.length === 0 ? (
        <EmptyState title="Belum ada pesan masuk" hint="Setelah URL webhook didaftarkan di KhfyPay dan ada transaksi, pesannya muncul di sini." />
      ) : (
        <TableWrap label="Pesan webhook">
          <thead><tr><th className={th}>Terakhir masuk</th><th className={th}>Hasil proses</th><th className={th}>reff_id</th><th className={th}>x</th><th className={th}>Isi pesan</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {events.map((e) => (
              <tr key={e.id}>
                <td className={`${td} whitespace-nowrap text-xs`}>{formatDateTime(e.last_received_at)}</td>
                <td className={`${td} font-mono text-xs`}>{e.outcome ?? "—"}</td>
                <td className={`${td} font-mono text-xs`}>{e.reff_id ?? "—"}</td>
                <td className={td}>{e.receive_count}</td>
                <td className={`${td} max-w-lg break-words font-mono text-xs`}>{preview(e.payload, 400)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}
