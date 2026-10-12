import { NextResponse } from "next/server";
import { cronSecret } from "@/lib/env/server";
import { getProvider } from "@/lib/providers";
import { isAuthorizedCron } from "@/lib/security/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { POLICY } from "@/lib/transactions/policy";
import { reconcilePending } from "@/lib/transactions/reconcile";
import { createTransactionRpc, type RpcCaller } from "@/lib/transactions/rpc";
import { createSupabaseTransactionStore } from "@/lib/transactions/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Reconciliation entry point. Disabled (POLICY.RECONCILE_ENABLED=false) => calls nothing, changes nothing. */
export async function GET(req: Request) {
  let secret: string;
  try { secret = cronSecret(); } catch { return NextResponse.json({ ok: false, error: "cron not configured" }, { status: 503 }); }
  if (!isAuthorizedCron(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const db = createAdminClient();
    const summary = await reconcilePending({
      provider: getProvider(),
      store: createSupabaseTransactionStore(db),
      rpc: createTransactionRpc(db as unknown as RpcCaller),
      enabled: POLICY.RECONCILE_ENABLED,
    });
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    console.error("reconcile failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "reconcile failed" }, { status: 500 });
  }
}
