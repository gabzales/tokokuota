import { describe, expect, it, vi } from "vitest";
import { forgotPasswordSchema, resetPasswordSchema } from "@/lib/auth/schemas";
import { buildSecurityHeaders } from "@/lib/security/headers";
import { clientIp, consume, consumeAll, LIMITS, limiterKey, rateLimitMessage } from "@/lib/security/rate-limit";
import type { RpcCaller } from "@/lib/transactions/rpc";

const h = (m: Record<string, string>) => ({ get: (n: string) => m[n.toLowerCase()] ?? null });
const rpcReturning = (data: unknown, error: { message: string } | null = null) => {
  const calls: Record<string, unknown>[] = [];
  const c: RpcCaller & { calls: typeof calls } = { calls, rpc: async (_f, a) => { calls.push(a ?? {}); return { data, error }; } };
  return c;
};

describe("security headers", () => {
  const prod = Object.fromEntries(buildSecurityHeaders({ isDev: false, supabaseUrl: "https://abc.supabase.co/rest/v1" }).map((x) => [x.key, x.value]));
  it("production: CSP forbids framing, plugins and foreign scripts; HSTS is on", () => {
    const csp = prod["Content-Security-Policy"]!;
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "upgrade-insecure-requests"]) expect(csp).toContain(d);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*https?:/);
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co");
    expect(prod["Strict-Transport-Security"]).toMatch(/max-age=\d{7,}/);
    expect(prod["X-Frame-Options"]).toBe("DENY");
    expect(prod["X-Content-Type-Options"]).toBe("nosniff");
    expect(prod["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(prod["Permissions-Policy"]).toContain("camera=()");
  });
  it("development allows eval/ws for hot reload but sends no HSTS", () => {
    const dev = Object.fromEntries(buildSecurityHeaders({ isDev: true }).map((x) => [x.key, x.value]));
    expect(dev["Content-Security-Policy"]).toContain("'unsafe-eval'");
    expect(dev["Strict-Transport-Security"]).toBeUndefined();
  });
  it("report-only mode swaps the header name (rollback switch) and a bad URL never throws", () => {
    const keys = buildSecurityHeaders({ isDev: false, reportOnly: true, supabaseUrl: "not a url" }).map((x) => x.key);
    expect(keys).toContain("Content-Security-Policy-Report-Only");
    expect(keys).not.toContain("Content-Security-Policy");
  });
});

describe("rate limiting helpers", () => {
  it("clientIp prefers x-vercel-forwarded-for, then x-real-ip, then the LAST x-forwarded-for, and rejects junk", () => {
    expect(clientIp(h({ "x-vercel-forwarded-for": "203.0.113.5", "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1" }))).toBe("203.0.113.5");
    expect(clientIp(h({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1" }))).toBe("203.0.113.9");
    // the first entry is client-supplied (spoofable); the last is appended by the nearest proxy
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(h({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
    for (const bad of ["", "not an ip!", "<script>", "a".repeat(100)]) expect(clientIp(h({ "x-real-ip": bad }))).toBe("unknown");
    expect(clientIp(h({}))).toBe("unknown");
  });
  it("keys are hashed (no e-mail / IP in clear), case-insensitive and short enough for the table", () => {
    const k = limiterKey("login:email", "Someone@Example.com");
    expect(k).toBe(limiterKey("login:email", " someone@example.com "));
    expect(k).not.toContain("someone");
    expect(k.length).toBeLessThanOrEqual(200);
    expect(limiterKey("login:ip", "1.2.3.4")).not.toBe(limiterKey("register:ip", "1.2.3.4"));
  });
  it("consume sends scope/limit/window and maps the answer", async () => {
    const c = rpcReturning([{ out_allowed: false, out_hits: 9, out_retry_after: 120 }]);
    expect(await consume(c, LIMITS.loginEmail, "a@b.com")).toEqual({ allowed: false, retryAfter: 120 });
    expect(c.calls[0]).toMatchObject({ p_limit: LIMITS.loginEmail.limit, p_window_seconds: LIMITS.loginEmail.windowSeconds });
    expect(String(c.calls[0]!.p_key)).toMatch(/^login:email:[0-9a-f]{32}$/);
  });
  it("fails OPEN (and logs) when the limiter errors or answers nonsense", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await consume(rpcReturning(null, { message: "db down" }), LIMITS.loginIp, "1.2.3.4")).toEqual({ allowed: true, retryAfter: 0 });
    expect(await consume(rpcReturning([{ weird: 1 }]), LIMITS.loginIp, "1.2.3.4")).toEqual({ allowed: true, retryAfter: 0 });
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
  it("consumeAll counts every check and reports the longest wait among refusals", async () => {
    const answers = [{ out_allowed: true, out_retry_after: 5 }, { out_allowed: false, out_retry_after: 30 }, { out_allowed: false, out_retry_after: 600 }];
    let i = 0;
    const c: RpcCaller = { rpc: async () => ({ data: [answers[i++]], error: null }) };
    const r = await consumeAll(c, [{ spec: LIMITS.loginIp, id: "a" }, { spec: LIMITS.loginEmail, id: "b" }, { spec: LIMITS.forgotIp, id: "c" }]);
    expect(i).toBe(3);
    expect(r).toEqual({ allowed: false, retryAfter: 600 });
  });
  it("messages use seconds under 90s and minutes above", () => {
    expect(rateLimitMessage(30)).toContain("30 detik");
    expect(rateLimitMessage(600)).toContain("10 menit");
  });
});

describe("password reset schemas", () => {
  it("forgot: normalises and validates the e-mail", () => {
    expect(forgotPasswordSchema.parse({ email: " A@B.com " }).email).toBe("a@b.com");
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
  it("reset: length 8-72 and both fields must match", () => {
    expect(resetPasswordSchema.safeParse({ password: "longenough1", confirm: "longenough1" }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ password: "short", confirm: "short" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: "x".repeat(73), confirm: "x".repeat(73) }).success).toBe(false);
    const r = resetPasswordSchema.safeParse({ password: "longenough1", confirm: "different12" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["confirm"]);
  });
});
