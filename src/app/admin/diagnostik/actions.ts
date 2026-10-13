"use server";

import { headers } from "next/headers";
import { getAdminActor } from "@/lib/admin/auth";
import { runDiagnostic } from "@/lib/diagnostics/run";
import { isDiagCheckId, type DiagResult } from "@/lib/diagnostics/types";
import { LIMITS } from "@/lib/security/rate-limit";
import { checkLimits } from "@/lib/security/rate-limit-server";
import { createAdminClient } from "@/lib/supabase/admin";

export type DiagActionResult = DiagResult | { error: string };

async function originFromRequest(): Promise<string | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return null;
  const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  return `${local ? "http" : "https"}://${host}`;
}

/**
 * Runs ONE diagnostic. Admin + MFA only (checked against the database), rate limited, read-only towards KhfyPay
 * (never /trx). The result is redacted, printed as one JSON line to the server log (visible in Vercel → Logs)
 * and stored in diagnostic_logs (best effort: a missing table must not break the test itself).
 */
export async function runDiagnosticAction(id: string): Promise<DiagActionResult> {
  const actor = await getAdminActor();
  if (!actor) return { error: "Akses ditolak." };
  if (!isDiagCheckId(id)) return { error: "Tes tidak dikenal." };
  const limited = await checkLimits([{ spec: LIMITS.diagAdmin, id: actor.id }]);
  if (limited) return { error: limited };

  const r = await runDiagnostic(id, { origin: await originFromRequest() });

  console.log(JSON.stringify({ evt: "diagnostic", check: r.id, status: r.status, code: r.code, http: r.httpStatus ?? null, ms: r.latencyMs ?? null, summary: r.summary }));
  try {
    const { error } = await createAdminClient().rpc("admin_log_diagnostic", {
      p_admin_id: actor.id, p_check_id: r.id, p_status: r.status, p_code: r.code, p_http_status: r.httpStatus ?? null,
      p_latency_ms: r.latencyMs ?? null, p_summary: r.summary, p_detail: r.detail ?? null,
    });
    if (error) console.warn("diagnostic log not stored:", error.code, error.message);
  } catch (e) {
    console.warn("diagnostic log not stored:", e instanceof Error ? e.message : e);
  }
  return r;
}
