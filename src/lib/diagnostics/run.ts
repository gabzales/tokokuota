import "server-only";
import { providerEnv, webhookSecret } from "@/lib/env/server";
import { KHFYPAY_WIRE } from "@/lib/providers/khfypay/wire";
import {
  buildCekStockAkrabRequest, buildHistoryRequest, buildListProductRequest, type BuiltRequest, type KhfyPayConfig,
} from "@/lib/providers/khfypay/request-builder";
import { redactAndTruncate } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  classifySupabaseError, envFindings, EXPECTED_TABLES, interpretKey, interpretProducts, interpretStock, interpretWebhook,
  missingMigrations, type SbErrorLike,
} from "./interpret";
import { probeHttp, type ProbeResult } from "./probe";
import { DIAG_CHECKS, type DiagCheckId, type DiagResult, type DiagStatus, type Verdict } from "./types";

/** Every secret the app holds: none of them may reach the browser, the log table or the server log. */
function allSecrets(): string[] {
  return [
    process.env.KHFYPAY_API_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.WEBHOOK_SECRET, process.env.CRON_SECRET,
    process.env.SETUP_SECRET, process.env.TELEGRAM_BOT_TOKEN,
  ].filter((v): v is string => !!v && v.length >= 4);
}

const titleOf = (id: DiagCheckId) => DIAG_CHECKS.find((c) => c.id === id)?.title ?? id;
const red = (s: string, max = 4000) => redactAndTruncate(s, allSecrets(), max);

function result(id: DiagCheckId, v: Verdict, extra: { httpStatus?: number; latencyMs?: number; detail?: string } = {}): DiagResult {
  return {
    id, title: titleOf(id), status: v.status, code: v.code, summary: red(v.summary, 400), hint: v.hint,
    httpStatus: extra.httpStatus, latencyMs: extra.latencyMs, detail: extra.detail ? red(extra.detail) : undefined, ranAt: new Date().toISOString(),
  };
}

function probeDetail(requestLine: string, p: ProbeResult): string {
  const lines = [`Permintaan: ${requestLine}`];
  lines.push(p.httpStatus !== undefined ? `Status: HTTP ${p.httpStatus}  (${p.latencyMs} ms)` : `Status: tidak ada jawaban HTTP  (${p.latencyMs} ms)`);
  if (p.contentType) lines.push(`Content-Type: ${p.contentType}`);
  if (p.server) lines.push(`Server: ${p.server}`);
  if (p.location) lines.push(`Location: ${p.location}`);
  if (p.errName || p.errMessage || p.errCause) lines.push(`Error: ${[p.errName, p.errMessage].filter(Boolean).join(": ")}${p.errCause ? `  (penyebab: ${p.errCause})` : ""}`);
  if (p.body !== undefined) lines.push("", p.body === "" ? "(isi respons kosong)" : "--- isi respons ---", p.body);
  if (p.bodyTruncated) lines.push("(dipotong; hanya awal respons yang ditampilkan)");
  return lines.join("\n");
}

// -------------------------------------------------------------------------------------------------------------- env
function checkEnv(): DiagResult {
  const { items, status } = envFindings(process.env);
  const icon = { ok: "OK     ", warn: "PERIKSA", invalid: "SALAH  ", missing: "KOSONG " } as const;
  const detail = [
    ...items.map((i) => `${icon[i.state]} ${i.name}${i.level === "optional" ? " (opsional)" : ""}: ${i.note}`),
    "",
    `VERCEL_ENV: ${process.env.VERCEL_ENV ?? "(bukan Vercel)"}   NODE_ENV: ${process.env.NODE_ENV}`,
    "Nilai rahasia tidak pernah ditampilkan, hanya status dan panjangnya.",
  ].join("\n");
  const bad = items.filter((i) => i.state === "missing" && i.level === "required" || i.state === "invalid").map((i) => i.name);
  const warn = items.filter((i) => i.state === "warn" || (i.state === "missing" && i.level === "optional")).map((i) => i.name);
  const v: Verdict =
    status === "fail" ? { status, code: "ENV_INVALID", summary: `Environment bermasalah: ${bad.join(", ")}.`, hint: "Perbaiki di Vercel → Settings → Environment Variables lalu redeploy (nilai baru baru berlaku setelah redeploy)." }
    : status === "warn" ? { status, code: "ENV_WARN", summary: `Environment wajib lengkap. Perlu dilihat: ${warn.join(", ")}.`, hint: "Bagian opsional/peringatan; lihat detail." }
    : { status, code: "OK", summary: "Semua environment terisi dan formatnya benar." };
  return result("env", v, { detail });
}

// ---------------------------------------------------------------------------------------------------------- supabase
async function checkSupabase(): Promise<DiagResult> {
  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch {
    return result("supabase", { status: "fail", code: "ENV_SUPABASE", summary: "Env Supabase belum valid, jadi koneksi tidak bisa dicoba.", hint: "Perbaiki dulu di tes 'Konfigurasi environment' di atas." });
  }
  const t0 = Date.now();
  const lines: string[] = [];
  const sbErr = (e: unknown): SbErrorLike => {
    const o = (e ?? {}) as SbErrorLike & { name?: string };
    return { message: o.message ?? String(e), code: o.code, details: o.details, hint: o.hint, status: o.status };
  };

  // 1) reachability + key: the cheapest authenticated call
  // GET (not HEAD): postgrest-js reports a HEAD 404 with an empty body as success, which would hide a missing table.
  // retry(false): supabase-js otherwise retries network failures with 1s+2s+4s backoff, which would make an unreachable
  // project take ~7s and can exceed the function time limit. abortSignal: a paused/hung project must not hang the test.
  const quick = () => AbortSignal.timeout(8000);
  const first = await db.from("profiles").select("id").limit(0).retry(false).abortSignal(quick());
  if (first.error && !["42P01", "PGRST205"].includes(first.error.code)) {
    const v = classifySupabaseError({ ...sbErr(first.error), status: first.status });
    return result("supabase", v, { latencyMs: Date.now() - t0, detail: `Error: ${JSON.stringify(sbErr(first.error))}\nHTTP: ${first.status}` });
  }

  // 2) every table the app needs; a missing one tells exactly which migration did not run
  const settled = await Promise.all(EXPECTED_TABLES.map(async ([table, mig]) => {
    const r = await db.from(table).select("*").limit(0).retry(false).abortSignal(quick());
    return { table, mig, error: r.error, status: r.status };
  }));
  const missing: string[] = [];
  const other: string[] = [];
  for (const s of settled) {
    if (!s.error) lines.push(`OK       ${s.table} (migrasi ${s.mig})`);
    else if (s.error.code === "42P01" || s.error.code === "PGRST205") { missing.push(s.table); lines.push(`HILANG   ${s.table} (butuh migrasi ${s.mig})`); }
    else { other.push(s.table); lines.push(`ERROR    ${s.table}: ${s.error.code} ${s.error.message}`); }
  }

  // 3) functions added by the later migrations
  const fnMissing: Array<readonly [string, string]> = [];
  for (const [fn, mig, args] of [["invite_code_valid", "0007", { p_code: "TK-0000-0000-0000" }], ["setup_needed", "0008", {}]] as const) {
    const r = await db.rpc(fn, args).abortSignal(quick());
    if (r.error && (r.error.code === "PGRST202" || /could not find the function/i.test(r.error.message))) { fnMissing.push([fn, mig]); lines.push(`HILANG   fungsi ${fn}() (butuh migrasi ${mig})`); }
    else if (r.error) { other.push(fn); lines.push(`ERROR    fungsi ${fn}(): ${r.error.code} ${r.error.message}`); }
    else lines.push(`OK       fungsi ${fn}() (migrasi ${mig})${fn === "setup_needed" ? ` → admin ${r.data === true ? "BELUM ada" : "sudah ada"}` : ""}`);
  }
  const latencyMs = Date.now() - t0;
  const migs = missingMigrations(missing, fnMissing);
  const detail = lines.join("\n");
  if (migs.length) {
    return result("supabase", { status: "fail", code: "SB_MIGRATION_MISSING", summary: `Terhubung, tapi migrasi belum lengkap: ${migs.join(", ")}.`,
      hint: "Project baru: jalankan supabase/ALL_MIGRATIONS.sql sekali. Kalau sudah terlanjur jalan sebagian: 00_RESET_DB.sql dulu, baru ALL_MIGRATIONS.sql." }, { latencyMs, detail });
  }
  if (other.length) {
    const first = settled.find((s) => s.error && s.error.code !== "42P01" && s.error.code !== "PGRST205");
    const v = first?.error ? classifySupabaseError({ ...sbErr(first.error), status: first.status }) : { status: "fail" as DiagStatus, code: "SB_ERROR", summary: "Beberapa objek database error." };
    return result("supabase", v, { latencyMs, detail });
  }
  return result("supabase", { status: "pass", code: "OK", summary: `Terhubung ke Supabase; ${EXPECTED_TABLES.length} tabel dan fungsi migrasi lengkap (${latencyMs} ms).` }, { latencyMs, detail });
}

// ---------------------------------------------------------------------------------------------------------- KhfyPay
function khfyConfig(id: DiagCheckId): { cfg: KhfyPayConfig } | { fail: DiagResult } {
  try {
    const e = providerEnv();
    return { cfg: { baseUrl: e.KHFYPAY_BASE_URL, apiKey: e.KHFYPAY_API_KEY, timeoutMs: e.KHFYPAY_TIMEOUT_MS } };
  } catch (err) {
    const names = String(err instanceof Error ? err.message : err).replace(/^.*\): /, "");
    return { fail: result(id, { status: "skip", code: "CFG_KHFY_MISSING", summary: `Env KhfyPay belum terisi/valid: ${names}.`,
      hint: "Isi KHFYPAY_BASE_URL (https://panel.khfy-store.com/api_v2) dan KHFYPAY_API_KEY di Vercel lalu redeploy. Aman: katalog masih kosong sehingga belum ada yang bisa dibeli, dan tes ini hanya membaca." }) };
  }
}

async function khfyProbe(id: DiagCheckId, build: (cfg: KhfyPayConfig) => BuiltRequest, maxBody: number,
  judge: (p: ProbeResult, t: number) => Verdict): Promise<DiagResult> {
  const c = khfyConfig(id);
  if ("fail" in c) return c.fail;
  let req: BuiltRequest;
  try {
    req = build(c.cfg);
  } catch (err) {
    return result(id, { status: "fail", code: "CFG_KHFY_INVALID", summary: `Permintaan tidak bisa dibentuk: ${err instanceof Error ? err.message : String(err)}`, hint: "Periksa KHFYPAY_BASE_URL (harus URL https yang valid)." });
  }
  const p = await probeHttp(req.url, { timeoutMs: c.cfg.timeoutMs, secrets: allSecrets(), maxBody });
  return result(id, judge(p, c.cfg.timeoutMs), { httpStatus: p.httpStatus, latencyMs: p.latencyMs, detail: probeDetail(`GET ${req.redactedUrl}`, p) });
}

const checkKhfyNetwork = () => khfyProbe("khfy_network", (cfg) => buildCekStockAkrabRequest(cfg, KHFYPAY_WIRE), 3000, interpretStock);
const checkKhfyKey = () => khfyProbe("khfy_key", (cfg) => buildHistoryRequest(cfg, KHFYPAY_WIRE, { reffId: `diag-${Date.now().toString(36)}` }), 3000, interpretKey);
const checkKhfyProducts = () => khfyProbe("khfy_products", (cfg) => buildListProductRequest(cfg, KHFYPAY_WIRE), 8000, interpretProducts);

// ---------------------------------------------------------------------------------------------------------- webhook
async function checkWebhook(origin: string | null): Promise<DiagResult> {
  let secret: string;
  try {
    secret = webhookSecret();
  } catch {
    return result("webhook", { status: "fail", code: "WEBHOOK_NOT_CONFIGURED", summary: "WEBHOOK_SECRET belum terisi atau kurang dari 24 karakter.", hint: "Isi di Vercel → Environment Variables lalu redeploy." });
  }
  if (!origin) return result("webhook", { status: "fail", code: "ORIGIN_UNKNOWN", summary: "Alamat situs tidak bisa ditentukan dari permintaan.", hint: "Buka halaman ini lewat domain situs (bukan lewat alamat IP)." });
  const masked = `${secret.slice(0, 4)}…${secret.slice(-4)}`;
  const msg = `DIAG-TES-${Date.now().toString(36)}`;
  const url = `${origin}/webhook/${encodeURIComponent(secret)}?message=${msg}`;
  const p = await probeHttp(url, { timeoutMs: 15000, secrets: allSecrets(), maxBody: 1500 });
  const registered = `${origin}/webhook/${masked}  (ganti ${masked} dengan WEBHOOK_SECRET lengkap saat mendaftar di panel KhfyPay)`;
  const detail = `URL yang didaftarkan di KhfyPay:\n${registered}\n\n${probeDetail(`GET ${origin}/webhook/${masked}?message=${msg}`, p)}`;
  return result("webhook", interpretWebhook(p, 15000), { httpStatus: p.httpStatus, latencyMs: p.latencyMs, detail });
}

/** Never throws: an unexpected exception becomes a FAIL result with a code, not a blank page. */
export async function runDiagnostic(id: DiagCheckId, ctx: { origin: string | null }): Promise<DiagResult> {
  try {
    switch (id) {
      case "env": return checkEnv();
      case "supabase": return await checkSupabase();
      case "khfy_network": return await checkKhfyNetwork();
      case "khfy_key": return await checkKhfyKey();
      case "khfy_products": return await checkKhfyProducts();
      case "webhook": return await checkWebhook(ctx.origin);
    }
  } catch (err) {
    return result(id, { status: "fail", code: "DIAG_INTERNAL", summary: `Tes itu sendiri error: ${err instanceof Error ? err.message : String(err)}`, hint: "Kirim detail ini ke developer." },
      { detail: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  }
}

export { checkEnv as runEnvCheck };
