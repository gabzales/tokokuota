import { createClient } from "@supabase/supabase-js";

/**
 * Anon client for the browser. RLS + column grants limit it to reading the signed-in
 * user's own rows; it cannot change saldo, transactions or the ledger. (Cookie-based
 * SSR auth via @supabase/ssr is added in Tahap 2.)
 */
export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, key);
}
