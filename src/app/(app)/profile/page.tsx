import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { NameForm, PasswordForm } from "@/components/ProfileForms";
import { Card, linkCls, PageHeader } from "@/components/ui";
import { getProfile, requireUser } from "@/lib/auth/require-user";
import { changePasswordAction, updateNameAction } from "./actions";

export const metadata = { title: "Akun — Toko Kuota" };

export default async function ProfilePage() {
  await requireUser();
  const profile = await getProfile();
  return (
    <AppShell>
      <PageHeader title="Akun" description={profile?.email ?? undefined} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card><h2 className="mb-3 font-semibold">Profil</h2><NameForm action={updateNameAction} defaultName={profile?.full_name ?? ""} /></Card>
        <Card><h2 className="mb-3 font-semibold">Ganti password</h2><PasswordForm action={changePasswordAction} /></Card>
      </div>
      <p className="text-sm text-muted">Butuh bantuan atau ingin menghapus akun? Lihat <Link href="/privacy" className={linkCls}>Kebijakan Privasi</Link>.</p>
    </AppShell>
  );
}
