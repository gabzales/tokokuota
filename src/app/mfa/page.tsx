import Link from "next/link";
import { notFound } from "next/navigation";
import { MfaEnroll, MfaVerifyForm } from "@/components/MfaForms";
import { Logo } from "@/components/Logo";
import { linkCls } from "@/components/ui";
import { getAdminSession } from "@/lib/admin/auth";
import { mfaRequired } from "@/lib/admin/mfa-policy";
import { safeNextPath } from "@/lib/auth/redirect";
import { createServerSupabase } from "@/lib/supabase/server";
import { startEnrollAction, verifyMfaAction } from "./actions";

export const metadata = { title: "Verifikasi dua langkah — Toko Kuota", robots: { index: false } };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const s = await getAdminSession();
  if (!s) notFound(); // only admins ever see this page
  const next = safeNextPath((await searchParams).next, "/admin");
  const supabase = await createServerSupabase();
  const { data: f } = await supabase.auth.mfa.listFactors();
  const verified = f?.totp?.[0];

  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <div className="mb-5 flex flex-col items-center gap-2"><Logo size={56} /><h1 className="text-xl font-bold">Verifikasi dua langkah</h1></div>
      <div className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
        {!mfaRequired() ? (
          <p className="text-sm text-muted">MFA tidak diwajibkan di lingkungan ini (ADMIN_MFA_REQUIRED=false). <Link href="/admin" className={linkCls}>Ke admin</Link></p>
        ) : s.aal === "aal2" ? (
          <p className="text-sm text-emerald-700">Sesi ini sudah terverifikasi. <Link href={next} className={linkCls}>Lanjut</Link></p>
        ) : verified ? (
          <>
            <p className="mb-4 text-sm text-muted">Masukkan kode dari aplikasi authenticator untuk membuka area admin.</p>
            <MfaVerifyForm action={verifyMfaAction} factorId={verified.id} next={next} />
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">Akun admin wajib memakai verifikasi dua langkah. Pasang aplikasi authenticator sekali, lalu setiap login admin cukup memasukkan kode 6 angka.</p>
            <MfaEnroll startAction={startEnrollAction} verifyAction={verifyMfaAction} next={next} />
          </>
        )}
      </div>
      <p className="mt-4 text-center text-sm"><Link href="/dashboard" className={linkCls}>← Kembali ke toko</Link></p>
    </main>
  );
}
