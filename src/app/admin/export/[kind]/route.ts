import { adminLabel, notify } from "@/lib/alerts/server";
import { getAdminActor } from "@/lib/admin/auth";
import { exportLedger, exportTransactions, type ExportLedgerRow, type ExportTxRow } from "@/lib/admin/queries";
import { toCsv, type Column } from "@/lib/export/csv";
import { EXPORT_MAX_ROWS, parseExportParams } from "@/lib/export/params";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TX: Column<ExportTxRow>[] = [
  { header: "Waktu", get: (r) => r.created_at }, { header: "Reff ID", get: (r) => r.reff_id }, { header: "Email user", get: (r) => r.user_email },
  { header: "Produk", get: (r) => r.product_name }, { header: "Kode provider", get: (r) => r.provider_code }, { header: "Tujuan", get: (r) => r.destination },
  { header: "Harga modal", get: (r) => r.cost_price }, { header: "Harga jual", get: (r) => r.sell_price }, { header: "Laba", get: (r) => r.profit },
  { header: "Status", get: (r) => r.status }, { header: "Percobaan kirim", get: (r) => r.provider_attempts }, { header: "Perlu review", get: (r) => (r.needs_review ? "ya" : "tidak") },
  { header: "Selesai", get: (r) => r.finalized_at },
];
const LEDGER: Column<ExportLedgerRow>[] = [
  { header: "Waktu", get: (r) => r.created_at }, { header: "Email user", get: (r) => r.user_email }, { header: "Jenis", get: (r) => r.type },
  { header: "Jumlah", get: (r) => r.amount }, { header: "Saldo sebelum", get: (r) => r.balance_before }, { header: "Saldo sesudah", get: (r) => r.balance_after },
  { header: "Reff ID transaksi", get: (r) => r.transaction_reff_id }, { header: "Catatan", get: (r) => r.note }, { header: "Dibuat oleh", get: (r) => r.created_by_email },
];

/** Admin-only CSV export. Every export is written to the audit log by the database function and announced by an alert. */
export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const actor = await getAdminActor(); // role from the DB + verified MFA session
  const { kind } = await ctx.params;
  if (!actor || (kind !== "transactions" && kind !== "ledger")) return new Response("Not found", { status: 404 });

  const p = parseExportParams(new URL(req.url).searchParams);
  if (!p.ok) return new Response(p.error, { status: 400 });

  try {
    const all = kind === "transactions" ? await exportTransactions(actor.id, p.fromIso, p.toIso, p.status) : await exportLedger(actor.id, p.fromIso, p.toIso, p.type);
    const truncated = all.length > EXPORT_MAX_ROWS;
    const rows = truncated ? all.slice(0, EXPORT_MAX_ROWS) : all;
    const csv = kind === "transactions" ? toCsv(TX, rows as ExportTxRow[]) : toCsv(LEDGER, rows as ExportLedgerRow[]);
    notify({ severity: "warn", title: "Ekspor data CSV", lines: [`${kind}, ${p.from} s/d ${p.to}, ${rows.length} baris`, `oleh ${adminLabel(actor)}`] });
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="toko-kuota-${kind}-${p.from}_${p.to}.csv"`,
        "cache-control": "no-store",
        ...(truncated ? { "x-export-truncated": "1" } : {}),
      },
    });
  } catch (e) {
    console.error("export failed", e instanceof Error ? e.message : e);
    return new Response("Export gagal", { status: 500 });
  }
}
