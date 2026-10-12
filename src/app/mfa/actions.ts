"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { failState, type ActionState } from "@/lib/action-state";
import { getAdminSession } from "@/lib/admin/auth";
import { safeNextPath } from "@/lib/auth/redirect";
import { LIMITS } from "@/lib/security/rate-limit";
import { checkLimits } from "@/lib/security/rate-limit-server";
import { createServerSupabase } from "@/lib/supabase/server";

export interface EnrollState { ok?: boolean; error?: string; factorId?: string; qr?: string; secret?: string }

/** Step 1 (admins without a verified authenticator): create a TOTP factor and return its QR + secret. */
export async function startEnrollAction(_p: EnrollState, _fd: FormData): Promise<EnrollState> {
  const s = await getAdminSession();
  if (!s) return { error: "Akses ditolak." };
  const supabase = await createServerSupabase();
  try {
    // abandoned, never-verified factors would block a new enrolment: drop them first
    const { data: f } = await supabase.auth.mfa.listFactors();
    for (const x of f?.all ?? []) if (x.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: x.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Toko Kuota ${new Date().toISOString().slice(0, 16)}`, issuer: "Toko Kuota" });
    if (error || !data) return { error: "Tidak bisa memulai pemasangan. Pastikan MFA (TOTP) aktif di pengaturan Auth Supabase." };
    return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
  } catch {
    return { error: "Terjadi gangguan. Coba lagi." };
  }
}

const verifySchema = z.object({ factorId: z.string().uuid(), code: z.string().trim().regex(/^\d{6}$/, "Kode harus 6 angka"), next: z.string().optional() });

/** Step 2 (and every later login): prove possession of the authenticator; the session becomes aal2. */
export async function verifyMfaAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await getAdminSession();
  if (!s) return failState("Akses ditolak.");
  const parsed = verifySchema.safeParse({ factorId: fd.get("factorId"), code: fd.get("code"), next: fd.get("next") ?? undefined });
  if (!parsed.success) return failState(parsed.error.issues[0]?.message ?? "Data tidak valid.");

  const limited = await checkLimits([{ spec: LIMITS.mfa, id: s.admin.id }]);
  if (limited) return failState(limited);

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: parsed.data.factorId, code: parsed.data.code });
  if (error) return failState("Kode salah atau sudah kedaluwarsa. Coba kode terbaru dari aplikasi authenticator.");
  redirect(safeNextPath(parsed.data.next, "/admin"));
}
