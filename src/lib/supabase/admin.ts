import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/env/server";
import { createTransactionRpc, type RpcCaller, type TransactionRpc } from "@/lib/transactions/rpc";

/** Service-role client: bypasses RLS. Server only; never import from client components. */
export function createAdminClient() {
  const env = supabaseEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAdminRpc(): TransactionRpc {
  return createTransactionRpc(createAdminClient() as unknown as RpcCaller);
}
