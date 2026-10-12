import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { isActiveAdmin } from "./guard";
import { adminAccess, mfaRequired, type Aal } from "./mfa-policy";

export interface AdminIdentity { id: string; email: string | null; full_name: string | null }

/**
 * Admin identity, decided by the DATABASE: the session user is verified with Supabase Auth, then
 * role/is_active are read with the service role. The session's assurance level (aal2 = passed a TOTP
 * code) decides whether it may use the admin area. Nothing comes from the browser or JWT metadata.
 * (Every admin RPC re-checks the role inside Postgres as well.)
 */
export const getAdminSession = cache(async () => {
  const user = await getUser();
  if (!user) return null;
  const { data } = await createAdminClient().from("profiles").select("id,email,full_name,role,is_active").eq("id", user.id).maybeSingle();
  if (!isActiveAdmin(data)) return null;
  const supabase = await createServerSupabase();
  const { data: a } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const aal = (a?.currentLevel ?? null) as Aal;
  const admin = data as AdminIdentity;
  return { admin, aal, access: adminAccess({ isAdmin: true, aal, required: mfaRequired() }) };
});

/** Admin who may use the admin area right now (role + MFA), or null. */
export async function getAdmin(): Promise<AdminIdentity | null> {
  const s = await getAdminSession();
  return s && s.access === "OK" ? s.admin : null;
}

/** For pages/layouts: non-admins get a 404; admins without a verified TOTP session go to /mfa. */
export async function requireAdmin(): Promise<AdminIdentity> {
  const s = await getAdminSession();
  if (!s || s.access === "DENY") notFound();
  if (s.access === "NEEDS_MFA") redirect("/mfa?next=/admin");
  return s.admin;
}

/** For server actions / route handlers: the acting admin, or null (never throws). */
export const getAdminActor = getAdmin;
export async function getAdminId(): Promise<string | null> {
  return (await getAdmin())?.id ?? null;
}
