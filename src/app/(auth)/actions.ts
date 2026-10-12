"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from "@/lib/auth/schemas";
import { failState, okState, type ActionState } from "@/lib/action-state";
import { getUser } from "@/lib/auth/require-user";
import { inviteCodeError, normalizeInviteCode } from "@/lib/invite";
import { createInviteRpc } from "@/lib/invite-rpc";
import { LIMITS } from "@/lib/security/rate-limit";
import { checkLimits, currentIp } from "@/lib/security/rate-limit-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import type { RpcCaller } from "@/lib/transactions/rpc";

export interface AuthFormState {
  error?: string;
  info?: string;
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Email atau password salah." };

  const limited = await checkLimits([
    { spec: LIMITS.loginIp, id: await currentIp() },
    { spec: LIMITS.loginEmail, id: parsed.data.email },
  ]);
  if (limited) return { error: limited };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // One generic message: never reveal whether the email exists.
  if (error) return { error: "Email atau password salah." };

  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function registerAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Data tidak valid." };

  const rawInvite = String(formData.get("inviteCode") ?? "");
  const inviteError = inviteCodeError(rawInvite);
  if (inviteError) return { error: inviteError };
  const inviteCode = normalizeInviteCode(rawInvite);

  const limited = await checkLimits([{ spec: LIMITS.registerIp, id: await currentIp() }]);
  if (limited) return { error: limited };

  // Friendly early answer. The real enforcement is the BEFORE INSERT trigger on auth.users (0007), which
  // also stops anyone who calls the Supabase Auth API directly.
  let valid = false;
  try {
    valid = await createInviteRpc(createAdminClient() as unknown as RpcCaller).isValid(inviteCode);
  } catch (e) {
    console.error("invite_code_valid failed:", e instanceof Error ? e.message : e);
    return { error: "Pendaftaran sedang bermasalah. Coba lagi sebentar." };
  }
  if (!valid) return { error: "Kode undangan tidak valid, sudah dipakai, atau kedaluwarsa. Minta kode baru ke admin." };

  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? h.get("origin") ?? "";

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Role/saldo are never taken from metadata (the DB trigger ignores everything but full_name).
      // invite_code is read (and consumed) by the signup gate trigger.
      data: { invite_code: inviteCode, ...(parsed.data.fullName ? { full_name: parsed.data.fullName } : {}) },
      emailRedirectTo: origin ? `${origin}/auth/callback` : undefined,
    },
  });
  if (error) return { error: "Pendaftaran gagal. Coba lagi atau gunakan email lain." };

  if (data.session) redirect("/dashboard");
  return { info: "Pendaftaran berhasil. Cek email kamu untuk konfirmasi, lalu login." };
}

export async function logoutAction() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Always answers the same, whether or not the e-mail exists (no account enumeration). */
export async function forgotPasswordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: fd.get("email") });
  if (!parsed.success) return failState(parsed.error.issues[0]?.message ?? "Email tidak valid.");

  const limited = await checkLimits([
    { spec: LIMITS.forgotIp, id: await currentIp() },
    { spec: LIMITS.forgotEmail, id: parsed.data.email },
  ]);
  if (limited) return failState(limited);

  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? h.get("origin") ?? "";
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: origin ? `${origin}/auth/callback?next=/reset-password` : undefined,
  });
  if (error) console.error("resetPasswordForEmail failed:", error.message);
  return okState("Jika email itu terdaftar, tautan untuk mengatur ulang password sudah dikirim. Cek kotak masuk dan folder spam.");
}

/** Needs the recovery session created by /auth/callback; the user is verified with Supabase Auth. */
export async function resetPasswordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return failState("Sesi tidak valid atau tautan sudah kedaluwarsa. Minta tautan baru.");

  const parsed = resetPasswordSchema.safeParse({ password: fd.get("password"), confirm: fd.get("confirm") });
  if (!parsed.success) return failState(parsed.error.issues[0]?.message ?? "Data tidak valid.");

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return failState("Password tidak dapat diubah. Coba minta tautan baru.");
  // a password change must end every other session (e.g. a stolen one)
  await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);
  redirect("/dashboard");
}
