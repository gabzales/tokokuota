import { NextResponse } from "next/server";
import { cronSecret } from "@/lib/env/server";
import { buildDigest, sendAlert } from "@/lib/alerts/notify";
import { getDashboardStats } from "@/lib/admin/queries";
import { startOfTodayJakarta } from "@/lib/admin/list-params";
import { isAuthorizedCron } from "@/lib/security/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTopupRpc } from "@/lib/topup/rpc";
import type { RpcCaller } from "@/lib/transactions/rpc";

export const dynamic = "force-dynamic";

/** Tidy-up only: expired requests also release their nominal lazily when a new request needs it. */
export async function GET(req: Request) {
  let secret: string;
  try { secret = cronSecret(); } catch { return NextResponse.json({ ok: false, error: "cron not configured" }, { status: 503 }); }
  if (!isAuthorizedCron(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const db = createAdminClient();
    const expired = await createTopupRpc(db as unknown as RpcCaller).expireStale();
    const { data: cleaned } = await db.rpc("rate_limit_cleanup");
    // daily digest to the admin Telegram chat (no-op when the bot is not configured)
    let digestSent = false;
    try {
      const since = new Date(Date.now() - 24 * 3600_000 + 7 * 3600_000); // yesterday in Jakarta: the cron runs at 03:30 WIB
      const stats = await getDashboardStats(startOfTodayJakarta(since));
      digestSent = await sendAlert(buildDigest(stats));
    } catch (e) {
      console.error("digest failed", e instanceof Error ? e.message : e);
    }
    return NextResponse.json({ ok: true, expired, rateLimitRowsRemoved: cleaned ?? 0, digestSent });
  } catch (e) {
    console.error("expire topups failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "failed" }, { status: 500 });
  }
}
