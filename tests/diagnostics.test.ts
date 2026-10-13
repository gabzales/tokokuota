import { describe, expect, it } from "vitest";
import {
  classifySupabaseError, describeJson, envFindings, interpretKey, interpretProducts, interpretStock, interpretTransport, interpretWebhook,
  jwtRole, missingMigrations,
} from "@/lib/diagnostics/interpret";
import { classifyHttpStatus, classifyNetworkError, probeHttp, type ProbeResult } from "@/lib/diagnostics/probe";
import { formatReport } from "@/lib/diagnostics/report";
import type { DiagResult } from "@/lib/diagnostics/types";

const SECRET = "SUPER-SECRET-API-KEY-123";
const fakeFetch = (res: Response | (() => Promise<Response>)) => (async () => (typeof res === "function" ? res() : res)) as unknown as typeof fetch;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const p = (over: Partial<ProbeResult>): ProbeResult => ({ code: "OK", latencyMs: 50, ...over });

describe("probeHttp", () => {
  it("classifies HTTP statuses", () => {
    expect(["200", "302", "401", "403", "404", "429", "418", "500", "503"].map((s) => classifyHttpStatus(Number(s)))).toEqual(
      ["OK", "HTTP_REDIRECT", "HTTP_401", "HTTP_403", "HTTP_404", "HTTP_429", "HTTP_4XX", "HTTP_5XX", "HTTP_5XX"]);
  });

  it("keeps status AND body for 4xx/5xx (the production client throws the body away)", async () => {
    const r = await probeHttp("https://x.test/a", { timeoutMs: 1000, secrets: [], fetchImpl: fakeFetch(json({ error: "api key salah" }, 401)) });
    expect(r.code).toBe("HTTP_401");
    expect(r.httpStatus).toBe(401);
    expect(r.body).toContain("api key salah");
    expect(r.json).toEqual({ error: "api key salah" });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("never echoes a secret that the server (or an error) repeats back", async () => {
    const r = await probeHttp("https://x.test/a", { timeoutMs: 1000, secrets: [SECRET], fetchImpl: fakeFetch(json({ echo: `api_key=${SECRET}` })) });
    expect(r.body).not.toContain(SECRET);
    expect(r.body).toContain("***");
    const e = await probeHttp("https://x.test/a", { timeoutMs: 1000, secrets: [SECRET], fetchImpl: (async () => { throw new TypeError(`bad url https://x/?api_key=${SECRET}`); }) as unknown as typeof fetch });
    expect(JSON.stringify(e)).not.toContain(SECRET);
  });

  it("does not follow redirects and reports where they point", async () => {
    const r = await probeHttp("https://x.test/a", { timeoutMs: 1000, secrets: [], fetchImpl: fakeFetch(new Response(null, { status: 301, headers: { location: "https://www.x.test/a" } })) });
    expect(r.code).toBe("HTTP_REDIRECT");
    expect(r.location).toBe("https://www.x.test/a");
  });

  it("truncates a huge body and says so", async () => {
    const r = await probeHttp("https://x.test/a", { timeoutMs: 1000, secrets: [], maxBody: 100, fetchImpl: fakeFetch(new Response("x".repeat(500))) });
    expect(r.bodyTruncated).toBe(true);
    expect((r.body ?? "").length).toBeLessThan(200);
  });

  it("maps the real network reasons hidden in err.cause.code", () => {
    const cause = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });
    expect(classifyNetworkError(cause("ENOTFOUND"), false).code).toBe("NET_DNS");
    expect(classifyNetworkError(cause("EAI_AGAIN"), false).code).toBe("NET_DNS");
    expect(classifyNetworkError(cause("ECONNREFUSED"), false).code).toBe("NET_REFUSED");
    expect(classifyNetworkError(cause("ECONNRESET"), false).code).toBe("NET_RESET");
    expect(classifyNetworkError(cause("UND_ERR_CONNECT_TIMEOUT"), false).code).toBe("NET_TIMEOUT");
    expect(classifyNetworkError(cause("CERT_HAS_EXPIRED"), false).code).toBe("NET_TLS");
    expect(classifyNetworkError(cause("DEPTH_ZERO_SELF_SIGNED_CERT"), false).code).toBe("NET_TLS");
    expect(classifyNetworkError(new Error("weird"), false).code).toBe("NET_UNKNOWN");
    expect(classifyNetworkError(new Error("x"), true).code).toBe("NET_TIMEOUT");
  });

  it("times out instead of hanging", async () => {
    const hang = ((_u: string, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch;
    const r = await probeHttp("https://x.test/a", { timeoutMs: 30, secrets: [], fetchImpl: hang });
    expect(r.code).toBe("NET_TIMEOUT");
    expect(r.httpStatus).toBeUndefined();
  });
});

describe("interpretation gives a code, an explanation and a next step", () => {
  it("every failure has a hint a non-developer can act on", () => {
    for (const code of ["NET_TIMEOUT", "NET_DNS", "NET_REFUSED", "NET_RESET", "NET_TLS", "NET_UNKNOWN", "HTTP_REDIRECT", "HTTP_401", "HTTP_403", "HTTP_404", "HTTP_429", "HTTP_4XX", "HTTP_5XX"] as const) {
      const v = interpretTransport(p({ code, httpStatus: 401, location: "https://y" }), 15000);
      expect(v?.status, code).toBe("fail");
      expect(v?.code).toBe(code);
      expect((v?.hint ?? "").length, code).toBeGreaterThan(20);
    }
    expect(interpretTransport(p({}))).toBeNull();
  });

  it("stock check: pass on JSON, warn on a 200 that is not JSON (WAF page)", () => {
    const ok = interpretStock(p({ httpStatus: 200, json: { ok: true, data: [] } }));
    expect(ok).toMatchObject({ status: "pass", code: "OK" });
    expect(ok.summary).toContain("object{ok,data}");
    expect(interpretStock(p({ httpStatus: 200, json: undefined, body: "<html>" }))).toMatchObject({ status: "warn", code: "BODY_NOT_JSON" });
  });

  it("key check: a body that complains about the key is a FAIL even with HTTP 200", () => {
    for (const body of ['{"message":"API key tidak valid"}', '{"error":"Unauthorized"}', '{"msg":"invalid api_key"}', '{"status":false,"pesan":"apikey salah"}']) {
      expect(interpretKey(p({ httpStatus: 200, json: {}, body })).code, body).toBe("KHFY_KEY_REJECTED");
    }
    expect(interpretKey(p({ httpStatus: 200, json: {}, body: '{"ok":false,"message":"transaksi tidak ditemukan"}' })).status).toBe("pass");
    expect(interpretKey(p({ code: "HTTP_401", httpStatus: 401 })).code).toBe("HTTP_401");
  });

  it("products check passes with a shape summary and a pointer to the next step", () => {
    const v = interpretProducts(p({ httpStatus: 200, json: [{ a: 1 }, { a: 2 }], body: "[...]" }));
    expect(v.status).toBe("pass");
    expect(v.summary).toContain("array(2)");
    expect(v.hint).toMatch(/parser/i);
  });

  it("webhook: tells apart wrong secret, platform protection page, missing config, db error, missing route", () => {
    expect(interpretWebhook(p({ httpStatus: 200, json: { ok: true, outcome: "UNPARSED" } }))).toMatchObject({ status: "pass" });
    expect(interpretWebhook(p({ code: "HTTP_401", httpStatus: 401, contentType: "application/json", body: '{"ok":false}' })).code).toBe("WEBHOOK_SECRET_MISMATCH");
    expect(interpretWebhook(p({ code: "HTTP_401", httpStatus: 401, contentType: "text/html", body: "<!doctype html>Authentication Required" })).code).toBe("WEBHOOK_BLOCKED_BY_PLATFORM");
    expect(interpretWebhook(p({ code: "HTTP_5XX", httpStatus: 503 })).code).toBe("WEBHOOK_NOT_CONFIGURED");
    expect(interpretWebhook(p({ code: "HTTP_5XX", httpStatus: 500 })).code).toBe("WEBHOOK_DB_ERROR");
    expect(interpretWebhook(p({ code: "HTTP_404", httpStatus: 404 })).code).toBe("WEBHOOK_ROUTE_MISSING");
    expect(interpretWebhook(p({ code: "NET_DNS" })).code).toBe("NET_DNS");
  });

  it("describeJson", () => {
    expect(describeJson([1, 2, 3])).toBe("array(3)");
    expect(describeJson({ a: 1, b: 2 })).toBe("object{a,b}");
    expect(describeJson("x")).toBe("string");
    expect(describeJson(null)).toBe("null");
  });
});

describe("Supabase error classification", () => {
  it("covers the failures people actually hit", () => {
    expect(classifySupabaseError({ message: "TypeError: fetch failed" }).code).toBe("SB_NETWORK");
    expect(classifySupabaseError({ message: "AbortError: This operation was aborted" }).code).toBe("SB_TIMEOUT");
    expect(classifySupabaseError({ message: "Invalid API key", status: 401 }).code).toBe("SB_BAD_KEY");
    expect(classifySupabaseError({ code: "PGRST301", message: "JWT expired" }).code).toBe("SB_BAD_KEY");
    expect(classifySupabaseError({ code: "PGRST202", message: "Could not find the function public.setup_needed" }).code).toBe("SB_MIGRATION_MISSING");
    expect(classifySupabaseError({ code: "42P01", message: 'relation "x" does not exist' }).code).toBe("SB_TABLE_MISSING");
    expect(classifySupabaseError({ code: "PGRST205", message: "Could not find the table 'public.x' in the schema cache" }).code).toBe("SB_TABLE_MISSING");
    expect(classifySupabaseError({ code: "42501", message: "permission denied for table x" }).code).toBe("SB_PERMISSION");
    expect(classifySupabaseError({ code: "XX000", message: "boom" }).code).toBe("SB_XX000");
  });
  it("names the migrations that did not run", () => {
    expect(missingMigrations(["topup_banks", "topup_requests", "invite_codes", "diagnostic_logs"])).toEqual(["0004", "0007", "0009"]);
    expect(missingMigrations([], [["setup_needed", "0008"]])).toEqual(["0008"]);
    expect(missingMigrations([])).toEqual([]);
  });
});

const jwt = (role: string) => `h.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.s`;
const GOOD = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon"), SUPABASE_SERVICE_ROLE_KEY: jwt("service_role") + "x".repeat(20),
  WEBHOOK_SECRET: "a".repeat(32), CRON_SECRET: "b".repeat(20),
};

describe("environment findings", () => {
  const state = (env: Record<string, string | undefined>, name: string) => envFindings(env).items.find((i) => i.name === name)?.state;

  it("a complete, correct setup passes (KhfyPay is optional)", () => {
    const r = envFindings(GOOD);
    expect(r.items.filter((i) => i.level === "required").every((i) => i.state === "ok")).toBe(true);
    expect(r.status).toBe("warn"); // KhfyPay not set yet => worth a look, not a failure
    expect(envFindings({ ...GOOD, KHFYPAY_BASE_URL: "https://panel.khfy-store.com/api_v2", KHFYPAY_API_KEY: "k".repeat(20) }).status).toBe("pass");
  });

  it("detects swapped Supabase keys", () => {
    expect(jwtRole(jwt("anon"))).toBe("anon");
    expect(state({ ...GOOD, SUPABASE_SERVICE_ROLE_KEY: jwt("anon") + "x".repeat(20) }, "SUPABASE_SERVICE_ROLE_KEY")).toBe("invalid");
    expect(state({ ...GOOD, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("service_role") }, "NEXT_PUBLIC_SUPABASE_ANON_KEY")).toBe("invalid");
    expect(state({ ...GOOD, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_abcdefghijklmnop" }, "NEXT_PUBLIC_SUPABASE_ANON_KEY")).toBe("invalid");
    expect(envFindings({ ...GOOD, SUPABASE_SERVICE_ROLE_KEY: jwt("anon") + "x".repeat(20) }).status).toBe("fail");
  });

  it("flags missing, short, wrongly shaped and reused values", () => {
    expect(state({ ...GOOD, WEBHOOK_SECRET: "" }, "WEBHOOK_SECRET")).toBe("missing");
    expect(state({ ...GOOD, WEBHOOK_SECRET: "short" }, "WEBHOOK_SECRET")).toBe("invalid");
    expect(state({ ...GOOD, WEBHOOK_SECRET: "a".repeat(30) + "&?" }, "WEBHOOK_SECRET")).toBe("warn");
    expect(state({ ...GOOD, CRON_SECRET: GOOD.WEBHOOK_SECRET }, "CRON_SECRET")).toBe("warn");
    expect(state({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: "abcd.supabase.co" }, "NEXT_PUBLIC_SUPABASE_URL")).toBe("invalid");
    expect(state({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co/" }, "NEXT_PUBLIC_SUPABASE_URL")).toBe("warn");
    expect(state({ ...GOOD, KHFYPAY_BASE_URL: "http://panel.khfy-store.com/api_v2" }, "KHFYPAY_BASE_URL")).toBe("invalid");
    expect(state({ ...GOOD, KHFYPAY_BASE_URL: "https://panel.khfy-store.com/api_v2/" }, "KHFYPAY_BASE_URL")).toBe("warn");
    expect(state({ ...GOOD, KHFYPAY_BASE_URL: "https://panel.khfy-store.com" }, "KHFYPAY_BASE_URL")).toBe("warn");
    expect(state({ ...GOOD, KHFYPAY_API_KEY: " abc " + "k".repeat(16) }, "KHFYPAY_API_KEY")).toBe("warn");
    expect(state({ ...GOOD, KHFYPAY_TIMEOUT_MS: "50" }, "KHFYPAY_TIMEOUT_MS")).toBe("invalid");
    expect(state({ ...GOOD, SETUP_SECRET: "s".repeat(30) }, "SETUP_SECRET")).toBe("warn");
  });

  it("never puts a secret value into any note", () => {
    const env = { ...GOOD, KHFYPAY_API_KEY: "TOP-SECRET-KHFY-KEY-9999", SETUP_SECRET: "TOP-SECRET-SETUP-VALUE-9999" };
    const text = JSON.stringify(envFindings(env));
    for (const v of [env.KHFYPAY_API_KEY, env.SETUP_SECRET, env.SUPABASE_SERVICE_ROLE_KEY, env.WEBHOOK_SECRET, env.CRON_SECRET]) expect(text).not.toContain(v);
  });
});

describe("report", () => {
  it("is a readable plain-text summary of every result", () => {
    const rs: DiagResult[] = [
      { id: "env", title: "Konfigurasi environment", status: "pass", code: "OK", summary: "ok", ranAt: "t" },
      { id: "khfy_key", title: "KhfyPay: API key", status: "fail", code: "HTTP_401", summary: "Ditolak", hint: "cek key", httpStatus: 401, latencyMs: 80, detail: "Permintaan: GET x\nStatus: HTTP 401", ranAt: "t" },
    ];
    const t = formatReport(rs, { generatedAt: "2026-10-13T00:00:00Z", site: "tokokuota.web.id" });
    expect(t).toContain("[PASS] Konfigurasi environment");
    expect(t).toContain("[FAIL] KhfyPay: API key");
    expect(t).toContain("kode: HTTP_401");
    expect(t).toContain("HTTP: 401");
    expect(t).toContain("saran: cek key");
    expect(t).toContain("Situs: tokokuota.web.id");
  });
});
