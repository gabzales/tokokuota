import { jakartaDate } from "@/lib/export/params";
import { btnSecondary, inputCls } from "./ui";

/** Plain GET form (no JavaScript): the browser downloads the CSV. Max 366 days, first 10.000 rows. */
export function ExportForm({ kind, options }: { kind: "transactions" | "ledger"; options: { name: "status" | "type"; label: string; values: string[] } }) {
  return (
    <details className="mb-4 rounded-2xl border border-slate-200 bg-surface">
      <summary className="cursor-pointer rounded-2xl px-4 py-3 text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">Ekspor CSV</summary>
      <form action={`/admin/export/${kind}`} method="get" className="flex flex-wrap items-end gap-3 border-t border-slate-100 px-4 py-4">
        <label className="text-sm"><span className="mb-1 block text-muted">Dari</span><input type="date" name="from" defaultValue={jakartaDate(30)} required className={inputCls} /></label>
        <label className="text-sm"><span className="mb-1 block text-muted">Sampai</span><input type="date" name="to" defaultValue={jakartaDate(0)} required className={inputCls} /></label>
        <label className="text-sm"><span className="mb-1 block text-muted">{options.label}</span>
          <select name={options.name} defaultValue="" className={inputCls}><option value="">Semua</option>{options.values.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        <button className={btnSecondary}>Unduh CSV</button>
        <p className="w-full text-xs text-muted">Maksimal 366 hari dan 10.000 baris per file. Setiap ekspor tercatat di audit dan memicu notifikasi.</p>
      </form>
    </details>
  );
}
