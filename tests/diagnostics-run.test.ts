import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runDiagnostic } from "@/lib/diagnostics/run";

// End-to-end through the REAL orchestration code against a local fake of KhfyPay, Supabase (PostgREST) and our own webhook.

const API_KEY = "KHFY-REAL-API-KEY-0123456789";
const SERVICE_KEY = "SERVICE-ROLE-KEY-ABCDEFGHIJKLMNOP";
const WEBHOOK = "w".repeat(32);

interface Fake {
  missingTables: Set<string>;
  missingFns: Set<string>;
  history: () => { status: number; body: string; type?: string };
  webhook: () => { status: number; body: string; type?: string };
  products: () => { status: number; body: string };
}
const fake: Fake = { missingTables: new Set(), missingFns: new Set(), history: () => ({ status: 200, body: "{}" }), webhook: () => ({ status: 200, body: "{}" }), products: () => ({ status: 200, body: "[]" }) };
const reset = () => {
  fake.missingTables = new Set();
  fake.missingFns = new Set();
  fake.history = () => ({ status: 200, body: JSON.stringify({ ok: false, message: "transaksi tidak ditemukan" }) });
  fake.webhook = () => ({ status: 200, body: JSON.stringify({ ok: true, outcome: "UNPARSED" }) });
  fake.products = () => ({ status: 200, body: JSON.stringify([{ kode: "A1" }, { kode: "A2" }]) });
};

const send = (res: ServerResponse, status: number, body: string, type = "application/json") => { res.writeHead(status, { "content-type": type }); res.end(body); };

function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  const rest = path.match(/^\/rest\/v1\/rpc\/(\w+)$/);
  if (rest) {
    const fn = rest[1] as string;
    return fake.missingFns.has(fn)
      ? send(res, 404, JSON.stringify({ code: "PGRST202", message: `Could not find the function public.${fn} in the schema cache` }))
      : send(res, 200, fn === "setup_needed" ? "false" : "false");
  }
  const tbl = path.match(/^\/rest\/v1\/(\w+)$/);
  if (tbl) {
    const t = tbl[1] as string;
    return fake.missingTables.has(t)
      ? send(res, 404, JSON.stringify({ code: "PGRST205", message: `Could not find the table 'public.${t}' in the schema cache` }))
      : send(res, 200, "[]");
  }
  if (path === "/api_v3/cek_stock_akrab") return send(res, 200, JSON.stringify({ ok: true, message: "success", data: [{ type: "XLA14", sisa_slot: 0 }] }));
  if (path === "/api_v2/history") {
    const h = fake.history();
    // a careless server echoing the request back, key included
    return send(res, h.status, h.body.replace("__KEY__", url.searchParams.get("api_key") ?? ""), h.type);
  }
  if (path === "/api_v2/list_product") { const r = fake.products(); return send(res, r.status, r.body); }
  if (path.startsWith("/webhook/")) { const w = fake.webhook(); return send(res, w.status, w.body, w.type); }
  send(res, 404, "not found", "text/plain");
}

let server: Server;
let origin: string;
beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** A port that is genuinely closed (port 1 is rejected by fetch itself as "bad port", which is a different error). */
async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

const setEnv = (over: Record<string, string> = {}) => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, WEBHOOK_SECRET: WEBHOOK, CRON_SECRET: "c".repeat(20),
    KHFYPAY_BASE_URL: `${origin}/api_v2`, KHFYPAY_API_KEY: API_KEY, KHFYPAY_TIMEOUT_MS: "3000", ...over,
  };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
};
afterEach(() => { vi.unstubAllEnvs(); reset(); });
reset();

const ctx = () => ({ origin });
const leaks = (x: unknown) => [API_KEY, SERVICE_KEY, WEBHOOK].filter((s) => JSON.stringify(x).includes(s));

describe("runDiagnostic against fakes", () => {
  it("a healthy system: everything passes and NO secret appears in any result", async () => {
    setEnv();
    const all = await Promise.all((["supabase", "khfy_network", "khfy_key", "khfy_products", "webhook"] as const).map((id) => runDiagnostic(id, ctx())));
    expect(all.map((r) => `${r.id}:${r.status}:${r.code}`)).toEqual([
      "supabase:pass:OK", "khfy_network:pass:OK", "khfy_key:pass:OK", "khfy_products:pass:OK", "webhook:pass:OK"]);
    expect(leaks(all)).toEqual([]);
    const key = all.find((r) => r.id === "khfy_key");
    expect(key?.detail).toContain("/api_v2/history");     // the exact request is shown...
    expect(key?.detail).not.toContain(API_KEY);           // ...with the key masked
    expect(all.find((r) => r.id === "khfy_products")?.summary).toContain("array(2)");
    expect(all.find((r) => r.id === "webhook")?.detail).toContain("/webhook/wwww…wwww");
  });

  it("Supabase: a missing table is FOUND (not silently passed) and the missing migrations are named", async () => {
    setEnv();
    fake.missingTables = new Set(["invite_codes", "diagnostic_logs", "topup_banks"]);
    fake.missingFns = new Set(["setup_needed"]);
    const r = await runDiagnostic("supabase", ctx());
    expect(r).toMatchObject({ status: "fail", code: "SB_MIGRATION_MISSING" });
    expect(r.summary).toContain("0004, 0007, 0008, 0009");
    expect(r.detail).toContain("HILANG   invite_codes");
    expect(r.detail).toContain("OK       profiles");
  });

  it("Supabase: unreachable host and bad env are reported with a code, not an exception", async () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${await closedPort()}` });
    const t0 = Date.now();
    const down = await runDiagnostic("supabase", ctx());
    expect(Date.now() - t0).toBeLessThan(3000); // no 1s+2s+4s retry backoff
    expect(down.status).toBe("fail");
    expect(down.code).toBe("SB_NETWORK");
    vi.unstubAllEnvs();
    setEnv({ SUPABASE_SERVICE_ROLE_KEY: "short" });
    expect((await runDiagnostic("supabase", ctx())).code).toBe("ENV_SUPABASE");
  });

  it("KhfyPay: a 200 that complains about the key is a FAIL, and an echoed key is masked", async () => {
    setEnv();
    fake.history = () => ({ status: 200, body: JSON.stringify({ message: "API key tidak valid", you_sent: "__KEY__" }) });
    const r = await runDiagnostic("khfy_key", ctx());
    expect(r).toMatchObject({ status: "fail", code: "KHFY_KEY_REJECTED", httpStatus: 200 });
    expect(r.detail).toContain("you_sent");
    expect(leaks(r)).toEqual([]);
  });

  it("KhfyPay: HTTP 403 with an HTML (WAF) page keeps the status and the body for diagnosis", async () => {
    setEnv();
    fake.history = () => ({ status: 403, body: "<html>Attention Required! | Cloudflare</html>", type: "text/html" });
    const r = await runDiagnostic("khfy_key", ctx());
    expect(r).toMatchObject({ status: "fail", code: "HTTP_403", httpStatus: 403 });
    expect(r.detail).toContain("Cloudflare");
    expect(r.hint).toMatch(/whitelist/i);
  });

  it("KhfyPay: nothing listening gives NET_REFUSED; missing env gives SKIP with the names", async () => {
    setEnv({ KHFYPAY_BASE_URL: `http://127.0.0.1:${await closedPort()}/api_v2` });
    expect((await runDiagnostic("khfy_network", ctx())).code).toBe("NET_REFUSED");
    vi.unstubAllEnvs();
    setEnv({ KHFYPAY_BASE_URL: "", KHFYPAY_API_KEY: "" });
    const skip = await runDiagnostic("khfy_products", ctx());
    expect(skip).toMatchObject({ status: "skip", code: "CFG_KHFY_MISSING" });
    expect(skip.summary).toContain("KHFYPAY_BASE_URL");
  });

  it("webhook: platform protection page, wrong secret, missing origin, missing secret", async () => {
    setEnv();
    fake.webhook = () => ({ status: 401, body: "<!doctype html><title>Authentication Required</title>", type: "text/html" });
    expect((await runDiagnostic("webhook", ctx())).code).toBe("WEBHOOK_BLOCKED_BY_PLATFORM");
    fake.webhook = () => ({ status: 401, body: '{"ok":false,"error":"unauthorized"}' });
    expect((await runDiagnostic("webhook", ctx())).code).toBe("WEBHOOK_SECRET_MISMATCH");
    expect((await runDiagnostic("webhook", { origin: null })).code).toBe("ORIGIN_UNKNOWN");
    vi.unstubAllEnvs();
    setEnv({ WEBHOOK_SECRET: "short" });
    expect((await runDiagnostic("webhook", ctx())).code).toBe("WEBHOOK_NOT_CONFIGURED");
  });

  it("env check never leaks and flags a swapped key", async () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value-1234567890" });
    const r = await runDiagnostic("env", ctx());
    expect(leaks(r)).toEqual([]);
    expect(r.detail).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });
});
