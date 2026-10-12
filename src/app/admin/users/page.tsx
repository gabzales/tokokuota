import Link from "next/link";
import { Badge, btnSecondary, EmptyState, FilterForm, inputCls, linkCls, PageHeader, Pagination, TableWrap, td, th } from "@/components/ui";
import { pageSlice, parseUserFilters, withParams } from "@/lib/admin/list-params";
import { listUsers } from "@/lib/admin/queries";
import { formatDateTime, formatRupiah } from "@/lib/format";

export const metadata = { title: "User — Admin" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseUserFilters(await searchParams);
  const { rows, hasNext } = pageSlice(await listUsers(f));

  return (
    <>
      <PageHeader title="User" description="Cari berdasarkan email atau nama." />
      <FilterForm action="/admin/users">
        <label className="min-w-0 flex-1"><span className="sr-only">Cari email atau nama</span>
          <input name="q" defaultValue={f.q} placeholder="Cari email / nama…" maxLength={80} className={inputCls} /></label>
        <label><span className="sr-only">Role</span>
          <select name="role" defaultValue={f.role ?? ""} className={inputCls}><option value="">Semua role</option><option value="user">User</option><option value="admin">Admin</option></select></label>
        <label><span className="sr-only">Status</span>
          <select name="active" defaultValue={f.active === undefined ? "" : String(f.active)} className={inputCls}><option value="">Semua status</option><option value="true">Aktif</option><option value="false">Nonaktif</option></select></label>
        <button className={btnSecondary}>Terapkan</button>
      </FilterForm>

      {rows.length === 0 ? <EmptyState title="User tidak ditemukan" hint="Ubah kata kunci atau filter." /> : (
        <TableWrap label="Daftar user">
          <thead><tr><th className={th}>Email</th><th className={th}>Nama</th><th className={th}>Role</th><th className={th}>Status</th><th className={`${th} text-right`}>Saldo</th><th className={th}>Daftar</th><th className={th} /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((u) => (
              <tr key={u.id}>
                <td className={`${td} max-w-52 truncate`}>{u.email}</td>
                <td className={td}>{u.full_name ?? "—"}</td>
                <td className={td}><Badge kind={u.role.toUpperCase()}>{u.role}</Badge></td>
                <td className={td}><Badge kind={u.is_active ? "ACTIVE" : "INACTIVE"}>{u.is_active ? "Aktif" : "Nonaktif"}</Badge></td>
                <td className={`${td} text-right tabular-nums`}>{formatRupiah(u.saldo)}</td>
                <td className={td}>{formatDateTime(u.created_at)}</td>
                <td className={td}><Link className={linkCls} href={`/admin/users/${u.id}`}>Detail</Link></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Pagination page={f.page} hasNext={hasNext} hrefFor={(p) => withParams("/admin/users", f, { page: p })} />
    </>
  );
}
