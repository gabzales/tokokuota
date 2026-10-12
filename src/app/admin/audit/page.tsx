import { EmptyState, PageHeader, Pagination, TableWrap, td, th } from "@/components/ui";
import { pageSlice, parsePage, withParams } from "@/lib/admin/list-params";
import { listAudit } from "@/lib/admin/queries";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Audit — Admin" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = parsePage(await searchParams);
  const { rows, hasNext } = pageSlice(await listAudit(page));

  return (
    <>
      <PageHeader title="Audit" description="Jejak semua perubahan oleh admin. Hanya tambah, tidak bisa diubah atau dihapus." />
      {rows.length === 0 ? <EmptyState title="Belum ada aktivitas admin" /> : (
        <TableWrap label="Audit admin">
          <thead><tr><th className={th}>Waktu</th><th className={th}>Admin</th><th className={th}>Aksi</th><th className={th}>Target</th><th className={th}>Detail</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((a) => (
              <tr key={a.id}>
                <td className={td}>{formatDateTime(a.created_at)}</td>
                <td className={`${td} max-w-40 truncate`}>{a.admin_email ?? "—"}</td>
                <td className={`${td} font-mono text-xs`}>{a.action}</td>
                <td className={`${td} break-all text-xs`}>{a.target_type}{a.target_id ? `: ${a.target_id}` : ""}</td>
                <td className={`${td} max-w-sm break-all font-mono text-[11px] text-muted`}>{JSON.stringify(a.details)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Pagination page={page} hasNext={hasNext} hrefFor={(p) => withParams("/admin/audit", {}, { page: p })} />
    </>
  );
}
