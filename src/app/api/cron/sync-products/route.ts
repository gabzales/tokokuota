import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { CATALOG_TAG } from "@/lib/catalog/cache";
import { syncCatalog } from "@/lib/catalog/sync";
import { cronSecret } from "@/lib/env/server";
import { getSyncOptions } from "@/lib/settings/server";
import { getProvider } from "@/lib/providers";
import { isAuthorizedCron } from "@/lib/security/cron";
import { createAdminRpc } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Catalogue sync (Vercel Cron, daily). Fails closed: until the real /list_product response is
 * mapped in providers/khfypay/parsers.ts the result is SKIPPED_UNPARSED and nothing is written.
 */
export async function GET(req: Request) {
  let secret: string;
  try { secret = cronSecret(); } catch { return NextResponse.json({ ok: false, error: "cron not configured" }, { status: 503 }); }
  if (!isAuthorizedCron(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const opts = await getSyncOptions();
    const result = await syncCatalog({ provider: getProvider(), rpc: createAdminRpc(), ...opts });
    if (result.status === "SYNCED") revalidateTag(CATALOG_TAG);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("catalog sync failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "sync failed" }, { status: 500 });
  }
}
