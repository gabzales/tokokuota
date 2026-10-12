import { createHash } from "node:crypto";
import type { RpcCaller } from "@/lib/transactions/rpc";

export interface LimitSpec { scope: string; limit: number; windowSeconds: number }

/** Fixed-window limits. Counted in Postgres (rate_limit_hit), so every serverless instance shares them. */
export const LIMITS = {
  loginIp:     { scope: "login:ip",     limit: 20, windowSeconds: 600 },
  loginEmail:  { scope: "login:email",  limit: 8,  windowSeconds: 600 },
  registerIp:  { scope: "register:ip",  limit: 5,  windowSeconds: 3600 },
  setupIp:     { scope: "setup:ip",     limit: 5,  windowSeconds: 3600 },
  forgotIp:    { scope: "forgot:ip",    limit: 10, windowSeconds: 3600 },
  forgotEmail: { scope: "forgot:email", limit: 3,  windowSeconds: 3600 },
  topupCreate: { scope: "topup:user",   limit: 10, windowSeconds: 3600 },
  checkout:    { scope: "checkout:user", limit: 30, windowSeconds: 600 },
  mfa:         { scope: "mfa:user",      limit: 10, windowSeconds: 600 },
  changePassword: { scope: "pwchange:user", limit: 5, windowSeconds: 3600 },
} as const satisfies Record<string, LimitSpec>;

/**
 * Client IP as seen by the platform. Order: x-vercel-forwarded-for (set by Vercel's edge, cannot be
 * supplied by the client) → x-real-ip → the LAST x-forwarded-for entry (the one appended by the
 * nearest proxy; the first entry is client-controlled and spoofable). Behind a proxy that does not
 * overwrite these headers they can still be spoofed: configure the proxy first.
 */
export function clientIp(h: { get(name: string): string | null }): string {
  const xff = h.get("x-forwarded-for")?.split(",").pop();
  const raw = h.get("x-vercel-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? xff ?? "";
  const ip = raw.trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : "unknown";
}

/** The stored key is a hash: no e-mail or IP address is kept in clear text. */
export function limiterKey(scope: string, id: string): string {
  return `${scope}:${createHash("sha256").update(id.trim().toLowerCase()).digest("hex").slice(0, 32)}`;
}

export interface RateResult { allowed: boolean; retryAfter: number }

/**
 * Counts one hit. Fails OPEN on a limiter error (logged): the limiter must never be the reason a
 * legitimate user cannot log in or pay; everything behind it still enforces its own rules.
 */
export async function consume(client: RpcCaller, spec: LimitSpec, id: string): Promise<RateResult> {
  try {
    const { data, error } = await client.rpc("rate_limit_hit", {
      p_key: limiterKey(spec.scope, id), p_limit: spec.limit, p_window_seconds: spec.windowSeconds,
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as { out_allowed?: boolean; out_retry_after?: number } | undefined;
    if (typeof row?.out_allowed !== "boolean") throw new Error("unexpected rate_limit_hit response");
    return { allowed: row.out_allowed, retryAfter: row.out_retry_after ?? 60 };
  } catch (e) {
    console.error(`rate limiter unavailable (${spec.scope}):`, e instanceof Error ? e.message : e);
    return { allowed: true, retryAfter: 0 };
  }
}

/** Every check is counted; the first refusal decides. */
export async function consumeAll(client: RpcCaller, checks: { spec: LimitSpec; id: string }[]): Promise<RateResult> {
  const results = await Promise.all(checks.map((c) => consume(client, c.spec, c.id)));
  const denied = results.filter((r) => !r.allowed).sort((a, b) => b.retryAfter - a.retryAfter)[0];
  return denied ?? { allowed: true, retryAfter: 0 };
}

export function rateLimitMessage(retryAfterSeconds: number): string {
  const mins = Math.ceil(retryAfterSeconds / 60);
  return retryAfterSeconds < 90
    ? `Terlalu banyak percobaan. Coba lagi dalam ${Math.max(1, retryAfterSeconds)} detik.`
    : `Terlalu banyak percobaan. Coba lagi dalam ${mins} menit.`;
}
