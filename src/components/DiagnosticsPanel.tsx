"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DIAG_CHECKS, type DiagCheckId, type DiagResult, type DiagStatus } from "@/lib/diagnostics/types";
import { formatReport } from "@/lib/diagnostics/report";
import { CopyButton } from "./CopyButton";
import { btnPrimary, btnSecondary, Card } from "./ui";

type RunAction = (id: string) => Promise<DiagResult | { error: string }>;

const PILL: Record<DiagStatus, { label: string; cls: string }> = {
  pass: { label: "LULUS", cls: "bg-emerald-100 text-emerald-800" },
  warn: { label: "PERIKSA", cls: "bg-amber-100 text-amber-800" },
  fail: { label: "GAGAL", cls: "bg-red-100 text-red-800" },
  skip: { label: "DILEWATI", cls: "bg-slate-200 text-slate-700" },
};

export function DiagnosticsPanel({ initial, run, site }: { initial: DiagResult; run: RunAction; site: string }) {
  const router = useRouter();
  const [results, setResults] = useState<Partial<Record<DiagCheckId, DiagResult>>>({ env: initial });
  const [errors, setErrors] = useState<Partial<Record<DiagCheckId, string>>>({});
  const [busy, setBusy] = useState<ReadonlySet<DiagCheckId>>(new Set());

  async function runOne(id: DiagCheckId) {
    setBusy((b) => new Set(b).add(id));
    setErrors((e) => ({ ...e, [id]: undefined }));
    try {
      const r = await run(id);
      if ("error" in r) setErrors((e) => ({ ...e, [id]: r.error }));
      else setResults((x) => ({ ...x, [id]: r }));
    } catch {
      setErrors((e) => ({ ...e, [id]: "Gagal menjalankan tes (koneksi ke aplikasi terputus atau sesi habis). Muat ulang halaman lalu coba lagi." }));
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(id); return n; });
    }
  }

  async function runAll() {
    for (const c of DIAG_CHECKS) await runOne(c.id);
    router.refresh();
  }

  const done = DIAG_CHECKS.map((c) => results[c.id]).filter((r): r is DiagResult => !!r);
  const report = () => formatReport(done, { generatedAt: new Date().toISOString(), site });
  const anyBusy = busy.size > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={runAll} disabled={anyBusy} className={`${btnPrimary} disabled:opacity-60`}>
          {anyBusy ? "Menjalankan…" : "Jalankan semua tes"}
        </button>
        <CopyButton value={report()} label="laporan lengkap" />
        <span className="text-xs text-muted">Tes KhfyPay hanya membaca. Tidak ada pembelian dan tidak ada saldo yang terpotong.</span>
      </div>

      <div aria-live="polite" className="space-y-3">
        {DIAG_CHECKS.map((c) => {
          const r = results[c.id];
          const isBusy = busy.has(c.id);
          return (
            <Card key={c.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold">{c.title}</h3>
                  {r && (
                    <p className="mt-1 text-sm">
                      <span className={`mr-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${PILL[r.status].cls}`}>{PILL[r.status].label}</span>
                      <code className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.code}</code>
                      {r.summary}
                    </p>
                  )}
                  {!r && !isBusy && <p className="mt-1 text-sm text-muted">Belum dijalankan.</p>}
                  {isBusy && <p className="mt-1 text-sm text-muted">Menjalankan…</p>}
                  {errors[c.id] && <p role="alert" className="mt-1 text-sm text-red-700">{errors[c.id]}</p>}
                </div>
                <button type="button" onClick={() => runOne(c.id)} disabled={isBusy} className={`${btnSecondary} disabled:opacity-60`}>
                  {r ? "Ulangi" : "Jalankan"}
                </button>
              </div>
              {r?.hint && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Saran: {r.hint}</p>}
              {r && (r.httpStatus !== undefined || r.latencyMs !== undefined) && (
                <p className="mt-2 text-xs text-muted">
                  {r.httpStatus !== undefined && <>HTTP {r.httpStatus} · </>}
                  {r.latencyMs !== undefined && <>{r.latencyMs} ms · </>}
                  {new Date(r.ranAt).toLocaleTimeString("id-ID")}
                </p>
              )}
              {r?.detail && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-primary">Detail teknis (mentah)</summary>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{r.detail}</pre>
                  <div className="mt-2"><CopyButton value={r.detail} label="detail" /></div>
                </details>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
