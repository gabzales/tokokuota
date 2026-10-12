import Link from "next/link";
import { ConfirmTopupForm, ResolveTransferForm } from "@/components/AdminForms";
import { Badge, btnSecondary, Card, EmptyState, FilterForm, inputCls, linkCls, PageHeader, Pagination } from "@/components/ui";
import { pageSlice, parseTopupFilters, withParams } from "@/lib/admin/list-params";
import { listTopups, listTransfers } from "@/lib/admin/queries";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { TRANSFER_REASONS } from "@/lib/topup/messages";
import { confirmTopupAction, resolveTransferAction } from "../actions";

export const metadata = { title: "Top-up — Admin" };

export default async function TopupsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseTopupFilters(await searchParams);
  const tab = (view: string, label: string) => (
    <Link href={withParams("/admin/topups", {}, { view })} aria-current={f.view === view ? "page" : undefined}
      className={`rounded-lg px-3 py-2 text-sm font-medium ${f.view === view ? "bg-primary/10 text-primary" : "text-muted hover:bg-slate-100"}`}>{label}</Link>
  );

  return (
    <>
      <PageHeader title="Top-up" description="Permintaan top-up user dan transfer masuk yang perlu dicek. Tidak ada yang dikreditkan otomatis kalau nominal tidak cocok, telat, atau akun nonaktif." />
      <div className="mb-4 flex gap-1" role="tablist" aria-label="Tampilan">{tab("requests", "Permintaan")}{tab("queue", "Perlu dicek")}</div>

      {f.view === "requests" ? <Requests f={f} /> : <Queue f={f} />}
    </>
  );
}

async function Requests({ f }: { f: ReturnType<typeof parseTopupFilters> }) {
  const status = f.status && ["PENDING", "PAID", "EXPIRED", "CANCELLED"].includes(f.status) ? f.status : undefined;
  const { rows, hasNext } = pageSlice(await listTopups({ status, q: f.q, page: f.page }));
  return (
    <>
      <FilterForm action="/admin/topups">
        <input type="hidden" name="view" value="requests" />
        <label className="min-w-0 flex-1"><span className="sr-only">Cari</span><input name="q" defaultValue={f.q} placeholder="Email user / nominal…" maxLength={80} className={inputCls} /></label>
        <label><span className="sr-only">Status</span>
          <select name="status" defaultValue={status ?? ""} className={inputCls}><option value="">Semua status</option>{["PENDING", "PAID", "EXPIRED", "CANCELLED"].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <button className={btnSecondary}>Terapkan</button>
      </FilterForm>
      {rows.length === 0 ? <EmptyState title="Belum ada permintaan top-up" hint="Permintaan muncul setelah user membuat top-up dan fitur diaktifkan di Pengaturan." /> : (
        <div className="space-y-3">
          {rows.map((r) => {
            const lapsed = r.status === "PENDING" && new Date(r.expires_at).getTime() < Date.now();
            const canConfirm = r.status === "PENDING" || r.status === "EXPIRED";
            return (
              <Card key={r.id} className="!p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold tabular-nums">{formatRupiah(r.total_amount)} <span className="text-sm font-normal text-muted">({formatRupiah(r.base_amount)} + kode {r.unique_code})</span></p>
                    <p className="text-sm"><Link className={linkCls} href={`/admin/users/${r.user_id}`}>{r.user_email}</Link> · {r.bank_code} · {formatDateTime(r.created_at)}</p>
                    <p className="text-xs text-muted">{r.status === "PAID" ? `Dibayar ${r.paid_at ? formatDateTime(r.paid_at) : ""}${r.bank_ref ? ` · ref ${r.bank_ref}` : ""}` : `Berlaku sampai ${formatDateTime(r.expires_at)}`}</p>
                  </div>
                  <Badge kind={lapsed ? "EXPIRED" : r.status}>{lapsed ? "EXPIRED" : r.status}</Badge>
                </div>
                {canConfirm && <div className="mt-3 border-t border-slate-100 pt-3"><ConfirmTopupForm action={confirmTopupAction} requestId={r.id} label={formatRupiah(r.total_amount)} /></div>}
              </Card>
            );
          })}
        </div>
      )}
      <Pagination page={f.page} hasNext={hasNext} hrefFor={(p) => withParams("/admin/topups", f, { page: p })} />
    </>
  );
}

async function Queue({ f }: { f: ReturnType<typeof parseTopupFilters> }) {
  const status = f.status && ["QUEUED", "CREDITED", "RESOLVED", "IGNORED"].includes(f.status) ? f.status : "QUEUED";
  const { rows, hasNext } = pageSlice(await listTransfers({ status, page: f.page }));
  return (
    <>
      <FilterForm action="/admin/topups">
        <input type="hidden" name="view" value="queue" />
        <label><span className="sr-only">Status transfer</span>
          <select name="status" defaultValue={status} className={inputCls}>{["QUEUED", "CREDITED", "RESOLVED", "IGNORED"].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <button className={btnSecondary}>Terapkan</button>
      </FilterForm>
      {rows.length === 0 ? <EmptyState title={status === "QUEUED" ? "Tidak ada transfer yang perlu dicek" : "Tidak ada data"} /> : (
        <div className="space-y-3">
          {rows.map((t) => (
            <Card key={t.id} className="!p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold tabular-nums">{formatRupiah(t.amount)} <span className="text-sm font-normal text-muted">{t.bank_code}</span></p>
                  <p className="text-xs text-muted">Masuk {formatDateTime(t.occurred_at)} · ref <span className="font-mono">{t.bank_ref}</span></p>
                  {t.reason && <p className="mt-1 text-sm text-amber-800">{TRANSFER_REASONS[t.reason] ?? t.reason}</p>}
                  {t.credited_user_email && <p className="text-sm">Dikreditkan ke {t.credited_user_email}</p>}
                  {t.resolved_note && <p className="text-xs text-muted">Catatan: {t.resolved_note}</p>}
                </div>
                <Badge kind={t.status}>{t.status}</Badge>
              </div>
              {t.status === "QUEUED" && <div className="mt-3 border-t border-slate-100 pt-3"><ResolveTransferForm action={resolveTransferAction} transferId={t.id} amountLabel={formatRupiah(t.amount)} /></div>}
            </Card>
          ))}
        </div>
      )}
      <Pagination page={f.page} hasNext={hasNext} hrefFor={(p) => withParams("/admin/topups", f, { page: p })} />
    </>
  );
}
