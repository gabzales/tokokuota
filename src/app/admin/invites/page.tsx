import { InviteForm, RevokeInviteForm } from "@/components/AdminForms";
import { CopyButton } from "@/components/CopyButton";
import { Badge, Card, EmptyState, PageHeader, TableWrap, td, th } from "@/components/ui";
import { listInvites, type InviteRow } from "@/lib/admin/queries";
import { formatDateTime } from "@/lib/format";
import { createInviteAction, revokeInviteAction } from "../actions";

export const metadata = { title: "Kode Undangan — Admin" };

function statusOf(c: InviteRow, now: number): { kind: "ACTIVE" | "USED" | "REVOKED" | "EXPIRED"; label: string } {
  if (c.used_at) return { kind: "USED", label: "Terpakai" };
  if (c.revoked_at) return { kind: "REVOKED", label: "Dicabut" };
  if (new Date(c.expires_at).getTime() <= now) return { kind: "EXPIRED", label: "Kedaluwarsa" };
  return { kind: "ACTIVE", label: "Aktif" };
}

export default async function InvitesPage() {
  const codes = await listInvites();
  const now = Date.now();
  return (
    <>
      <PageHeader title="Kode Undangan" description="Pendaftaran hanya bisa dengan kode dari sini. Satu kode untuk satu akun, dan kedaluwarsa otomatis." />
      <Card>
        <h2 className="mb-3 font-semibold">Buat kode baru</h2>
        <InviteForm action={createInviteAction} />
      </Card>
      <div className="mt-6">
        {codes.length === 0 ? <EmptyState title="Belum ada kode undangan" /> : (
          <TableWrap label="Kode undangan">
            <thead><tr><th className={th}>Kode</th><th className={th}>Catatan</th><th className={th}>Status</th><th className={th}>Berlaku sampai</th><th className={th}>Dipakai oleh</th><th className={th}><span className="sr-only">Aksi</span></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {codes.map((c) => {
                const st = statusOf(c, now);
                return (
                  <tr key={c.id}>
                    <td className={`${td} font-mono text-xs`}>{c.code}</td>
                    <td className={`${td} max-w-48 truncate`}>{c.note ?? "—"}</td>
                    <td className={td}><Badge kind={st.kind}>{st.label}</Badge></td>
                    <td className={td}>{formatDateTime(c.expires_at)}</td>
                    <td className={`${td} max-w-48 truncate text-xs`}>{c.used_email ?? "—"}</td>
                    <td className={td}>
                      {st.kind === "ACTIVE" && (
                        <div className="flex items-center gap-2"><CopyButton value={c.code} label="kode" /><RevokeInviteForm action={revokeInviteAction} id={c.id} /></div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </div>
    </>
  );
}
