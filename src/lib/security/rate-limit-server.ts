import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RpcCaller } from "@/lib/transactions/rpc";
import { clientIp, consumeAll, rateLimitMessage, type LimitSpec } from "./rate-limit";

export async function currentIp(): Promise<string> {
  return clientIp(await headers());
}

/** Returns an error message when any limit is exceeded, otherwise null. */
export async function checkLimits(checks: { spec: LimitSpec; id: string }[]): Promise<string | null> {
  const r = await consumeAll(createAdminClient() as unknown as RpcCaller, checks);
  return r.allowed ? null : rateLimitMessage(r.retryAfter);
}
