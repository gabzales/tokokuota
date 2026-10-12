import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

/** Verified user (getUser() asks Supabase Auth; the JWT in the cookie is never trusted blindly). */
export const getUser = cache(async () => {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

/**
 * Fast identity for READ-ONLY pages: the session JWT is verified locally (signature + expiry), without a
 * round trip to Supabase Auth on every navigation. Anything that MOVES MONEY or changes an account
 * (checkout, top-up, password, admin) keeps using getUser() above, which asks Supabase Auth.
 */
export const getSessionUser = cache(async () => {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return sub ? { id: sub, email: (data?.claims?.email as string | undefined) ?? null } : null;
});

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  saldo: number;
  is_active: boolean;
}

/** Own profile via RLS (column-limited). One query per request thanks to cache(). */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("profiles")
    .select("id,full_name,email,role,saldo,is_active")
    .eq("id", user.id)
    .maybeSingle();
  return (data as Profile | null) ?? null;
});
