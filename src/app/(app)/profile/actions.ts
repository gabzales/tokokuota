"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failState, okState, type ActionState } from "@/lib/action-state";
import { changePasswordSchema, profileNameSchema } from "@/lib/auth/schemas";
import { getUser } from "@/lib/auth/require-user";
import { LIMITS } from "@/lib/security/rate-limit";
import { checkLimits } from "@/lib/security/rate-limit-server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function updateNameAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) redirect("/login");
  const parsed = profileNameSchema.safeParse({ fullName: fd.get("fullName") ?? undefined });
  if (!parsed.success) return failState(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const supabase = await createServerSupabase();
  // Column grant + RLS: a user can only ever change full_name on their own row.
  const { error } = await supabase.from("profiles").update({ full_name: parsed.data.fullName ?? null }).eq("id", user.id);
  if (error) return failState("Nama tidak dapat disimpan. Coba lagi.");
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return okState("Nama disimpan.");
}

/** Requires the CURRENT password (so a stolen session alone cannot take over the account). */
export async function changePasswordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user?.email) redirect("/login");
  const parsed = changePasswordSchema.safeParse({ current: fd.get("current"), password: fd.get("password"), confirm: fd.get("confirm") });
  if (!parsed.success) return failState(parsed.error.issues[0]?.message ?? "Data tidak valid.");

  const limited = await checkLimits([{ spec: LIMITS.changePassword, id: user.id }]);
  if (limited) return failState(limited);

  const supabase = await createServerSupabase();
  const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: parsed.data.current });
  if (authError) return failState("Password saat ini salah.");
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return failState("Password tidak dapat diganti. Coba lagi.");
  await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);
  return okState("Password diganti. Perangkat lain sudah dikeluarkan.");
}
