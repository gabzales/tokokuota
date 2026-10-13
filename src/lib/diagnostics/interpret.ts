import type { ProbeResult } from "./probe";
import type { DiagStatus, Verdict } from "./types";

// Pure functions only (no I/O): everything here is unit-tested. They turn raw facts into a code + a plain-Indonesian
// explanation + what to do next.

const ms = (n: number) => `${n} ms`;

/** Why did the request not give a usable HTTP answer / a 2xx? Returns null when the probe is a plain 2xx. */
export function interpretTransport(p: ProbeResult, timeoutMs?: number): Verdict | null {
  switch (p.code) {
    case "OK":
      return null;
    case "NET_TIMEOUT":
      return { status: "fail", code: p.code, summary: `Tidak ada jawaban${timeoutMs ? ` dalam ${timeoutMs} ms` : ""}.`,
        hint: "Server lambat atau memblokir koneksi. Naikkan KHFYPAY_TIMEOUT_MS (maks 60000) dan coba lagi; kalau tetap, tanyakan KhfyPay apakah mereka membatasi IP (whitelist)." };
    case "NET_DNS":
      return { status: "fail", code: p.code, summary: "Nama domain tidak ditemukan.", hint: "Periksa penulisan host di URL (typo?) dan pastikan domainnya aktif." };
    case "NET_REFUSED":
      return { status: "fail", code: p.code, summary: "Koneksi ditolak oleh server tujuan.", hint: "Host/port salah atau layanannya sedang mati." };
    case "NET_RESET":
      return { status: "fail", code: p.code, summary: "Koneksi diputus oleh server di tengah jalan.", hint: "Sering tanda firewall atau pembatasan IP di sisi tujuan. Coba lagi; kalau berulang, tanyakan penyedia soal whitelist IP." };
    case "NET_TLS":
      return { status: "fail", code: p.code, summary: "Sertifikat HTTPS bermasalah.", hint: "Pastikan URL memakai https dan domainnya benar (bukan alamat IP atau domain lain)." };
    case "NET_UNKNOWN":
      return { status: "fail", code: p.code, summary: `Gagal terhubung: ${p.errMessage ?? "alasan tidak diketahui"}.`, hint: "Lihat detail teknis di bawah dan kirim ke developer." };
    case "HTTP_REDIRECT":
      return { status: "fail", code: p.code, summary: `Dialihkan (HTTP ${p.httpStatus}) ke ${p.location ?? "alamat lain"}.`,
        hint: "Pakai alamat tujuan itu di KHFYPAY_BASE_URL (harus https, dan jangan berakhir dengan garis miring)." };
    case "HTTP_401":
    case "HTTP_403":
      return { status: "fail", code: p.code, summary: `Ditolak (HTTP ${p.httpStatus}).`,
        hint: "Kemungkinan: API key salah atau belum aktif, atau IP server belum di-whitelist di panel KhfyPay (IP Vercel berubah-ubah; kalau KhfyPay mewajibkan whitelist IP, tanyakan solusinya). Jika isinya halaman HTML (Cloudflare/WAF), itu pemblokiran IP." };
    case "HTTP_404":
      return { status: "fail", code: p.code, summary: "Alamat tidak ditemukan (HTTP 404).", hint: "Cek KHFYPAY_BASE_URL: harus berakhir di /api_v2 (tanpa / di akhir) dan tidak ada typo." };
    case "HTTP_429":
      return { status: "fail", code: p.code, summary: "Terlalu banyak permintaan (HTTP 429).", hint: "Tunggu beberapa menit lalu ulangi." };
    case "HTTP_4XX":
      return { status: "fail", code: p.code, summary: `Permintaan ditolak (HTTP ${p.httpStatus}).`, hint: "Lihat isi respons di detail untuk alasan dari server." };
    case "HTTP_5XX":
      return { status: "fail", code: p.code, summary: `Server tujuan error (HTTP ${p.httpStatus}).`, hint: "Masalah di sisi mereka. Coba lagi nanti; kalau terus berlanjut, hubungi penyedia." };
  }
}

/** Short description of a parsed JSON body, e.g. "array(120)" or "object{ok,message,data}". */
export function describeJson(json: unknown): string {
  if (Array.isArray(json)) return `array(${json.length})`;
  if (json === null) return "null";
  if (typeof json === "object") {
    const keys = Object.keys(json as object);
    return `object{${keys.slice(0, 8).join(",")}${keys.length > 8 ? ",…" : ""}}`;
  }
  return typeof json;
}

const NOT_JSON_HINT = "Respons 200 tapi bukan JSON. Kemungkinan halaman pemblokir (Cloudflare/WAF) atau alamat salah. Lihat isi respons di detail.";

export function interpretStock(p: ProbeResult, timeoutMs?: number): Verdict {
  const t = interpretTransport(p, timeoutMs);
  if (t) return t;
  if (p.json === undefined) return { status: "warn", code: "BODY_NOT_JSON", summary: "Server menjawab tetapi isinya bukan JSON.", hint: NOT_JSON_HINT };
  return { status: "pass", code: "OK", summary: `Server KhfyPay terjangkau (HTTP ${p.httpStatus}, ${ms(p.latencyMs)}, ${describeJson(p.json)}).` };
}

const KEY_REJECTED = /unauthori[sz]ed|forbidden|invalid[\s_-]*(api[\s_-]*)?key|api[\s_-]*key.{0,40}(invalid|salah|tidak\s*valid|not\s*found|wrong|missing|kosong|required)|apikey.{0,40}(invalid|salah)|key\s*(tidak|salah)/i;

/** /history with a refid that does not exist: a healthy key answers "not found", a bad key says so. */
export function interpretKey(p: ProbeResult, timeoutMs?: number): Verdict {
  const t = interpretTransport(p, timeoutMs);
  if (t) return t;
  if (p.json === undefined) return { status: "warn", code: "BODY_NOT_JSON", summary: "Server menjawab tetapi isinya bukan JSON.", hint: NOT_JSON_HINT };
  if (KEY_REJECTED.test(p.body ?? "")) {
    return { status: "fail", code: "KHFY_KEY_REJECTED", summary: "Respons menyebut API key bermasalah.",
      hint: "Periksa KHFYPAY_API_KEY di Vercel (salah salin, spasi di ujung, atau key belum aktif). Baca isi respons di detail." };
  }
  return { status: "pass", code: "OK", summary: `Server menerima permintaan dan tidak menolak API key (HTTP ${p.httpStatus}, ${ms(p.latencyMs)}).`,
    hint: "Pastikan isi respons di detail wajar (mis. 'transaksi tidak ditemukan' untuk refid uji)." };
}

export function interpretProducts(p: ProbeResult, timeoutMs?: number): Verdict {
  const t = interpretTransport(p, timeoutMs);
  if (t) return t;
  if (p.json === undefined) return { status: "warn", code: "BODY_NOT_JSON", summary: "Server menjawab tetapi isinya bukan JSON.", hint: NOT_JSON_HINT };
  if (KEY_REJECTED.test(p.body ?? "")) {
    return { status: "fail", code: "KHFY_KEY_REJECTED", summary: "Respons menyebut API key bermasalah.", hint: "Periksa KHFYPAY_API_KEY di Vercel. Baca isi respons di detail." };
  }
  return { status: "pass", code: "OK", summary: `Sample diterima (HTTP ${p.httpStatus}, ${ms(p.latencyMs)}, ${describeJson(p.json)}).`,
    hint: "Salin isi detail dan kirim ke Claude untuk membuat parser katalog." };
}

/** The loopback call to our own /webhook/<secret>?message=… */
export function interpretWebhook(p: ProbeResult, timeoutMs?: number): Verdict {
  if (p.code === "OK") {
    const j = (p.json ?? {}) as { ok?: unknown; outcome?: unknown };
    if (j.ok === true) return { status: "pass", code: "OK", summary: `Webhook menerima pesan uji (HTTP ${p.httpStatus}, ${ms(p.latencyMs)}, hasil: ${String(j.outcome ?? "-")}).`,
      hint: "Pesan uji tercatat di bagian 'Pesan webhook terakhir' di bawah. Hasil UNPARSED itu wajar sebelum Tahap 2B." };
    return { status: "warn", code: "WEBHOOK_UNEXPECTED_BODY", summary: "Endpoint menjawab 200 tapi bentuk jawabannya tidak dikenal.", hint: "Kemungkinan domain ini mengarah ke aplikasi lain. Lihat detail." };
  }
  if (p.httpStatus === 401) {
    const html = /text\/html/i.test(p.contentType ?? "") || /^\s*</.test(p.body ?? "");
    return html
      ? { status: "fail", code: "WEBHOOK_BLOCKED_BY_PLATFORM", summary: "Ditolak halaman perlindungan (HTML), bukan oleh aplikasi.",
          hint: "Kemungkinan Vercel Deployment Protection aktif. Matikan di Vercel → Settings → Deployment Protection, atau pakai domain produksi. Selama aktif, KhfyPay juga tidak bisa memanggil webhook." }
      : { status: "fail", code: "WEBHOOK_SECRET_MISMATCH", summary: "Secret di URL tidak cocok dengan WEBHOOK_SECRET.", hint: "Pastikan env WEBHOOK_SECRET sama persis di semua environment, lalu redeploy." };
  }
  if (p.httpStatus === 503) return { status: "fail", code: "WEBHOOK_NOT_CONFIGURED", summary: "WEBHOOK_SECRET belum terisi atau terlalu pendek (minimal 24 karakter).", hint: "Isi di Vercel → Environment Variables lalu redeploy." };
  if (p.httpStatus === 500) return { status: "fail", code: "WEBHOOK_DB_ERROR", summary: "Webhook menerima pesan tapi gagal menyimpan (HTTP 500).", hint: "Biasanya database belum siap: jalankan tes Supabase di atas dan periksa migrasi." };
  if (p.httpStatus === 404) return { status: "fail", code: "WEBHOOK_ROUTE_MISSING", summary: "Rute webhook tidak ada di domain ini (HTTP 404).", hint: "Domain mungkin mengarah ke deployment lain atau versi lama. Pastikan deploy terbaru aktif di domain ini." };
  return interpretTransport(p, timeoutMs) ?? { status: "fail", code: "WEBHOOK_ERROR", summary: `Webhook menjawab HTTP ${p.httpStatus}.` };
}

// ---------------------------------------------------------------------------------------------------------- Supabase

export interface SbErrorLike { message?: string; code?: string; details?: string; hint?: string; status?: number }

export function classifySupabaseError(e: SbErrorLike): Verdict {
  const msg = e.message ?? "";
  const code = e.code ?? "";
  if (/abort|timeout|timed out/i.test(msg) && !code) {
    return { status: "fail", code: "SB_TIMEOUT", summary: "Supabase tidak menjawab (timeout).",
      hint: "Project Supabase gratis di-pause saat lama tidak aktif: buka dashboard Supabase dan klik Restore project, lalu tunggu beberapa menit. Atau cek NEXT_PUBLIC_SUPABASE_URL." };
  }
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network|getaddrinfo/i.test(msg) && !code) {
    return { status: "fail", code: "SB_NETWORK", summary: "Tidak bisa menghubungi Supabase.",
      hint: "Cek NEXT_PUBLIC_SUPABASE_URL (typo?) dan pastikan project Supabase tidak sedang di-pause (paket gratis mem-pause project yang lama tidak aktif)." };
  }
  if (/invalid api key|jwt|apikey/i.test(msg) || code === "PGRST301" || code === "PGRST300" || e.status === 401) {
    return { status: "fail", code: "SB_BAD_KEY", summary: "API key Supabase ditolak.",
      hint: "SUPABASE_SERVICE_ROLE_KEY salah, tertukar dengan anon key, atau milik project lain. Ambil ulang di Supabase → Project Settings → API." };
  }
  if (code === "PGRST202" || /could not find the function/i.test(msg)) {
    return { status: "fail", code: "SB_MIGRATION_MISSING", summary: "Fungsi database belum ada (migrasi belum dijalankan lengkap).", hint: "Jalankan migrasi yang kurang secara berurutan (supabase/ALL_MIGRATIONS.sql untuk project baru)." };
  }
  if (code === "42P01" || code === "PGRST205" || /could not find the table|does not exist|schema cache/i.test(msg)) {
    return { status: "fail", code: "SB_TABLE_MISSING", summary: "Tabel database belum ada (migrasi belum dijalankan lengkap).", hint: "Jalankan migrasi yang kurang secara berurutan (supabase/ALL_MIGRATIONS.sql untuk project baru)." };
  }
  if (code === "42501" || /permission denied/i.test(msg)) {
    return { status: "fail", code: "SB_PERMISSION", summary: "Hak akses database kurang (permission denied).", hint: "Biasanya migrasi terpotong sebelum bagian GRANT. Jalankan ulang migrasi dari awal pada project kosong (00_RESET_DB.sql lalu ALL_MIGRATIONS.sql)." };
  }
  return { status: "fail", code: code ? `SB_${code}` : "SB_ERROR", summary: `Supabase mengembalikan error${code ? ` ${code}` : ""}: ${msg || "tanpa pesan"}.`, hint: "Lihat detail teknis di bawah dan kirim ke developer." };
}

/** table (or function) -> the migration that creates it */
export const EXPECTED_TABLES: ReadonlyArray<readonly [string, string]> = [
  ["profiles", "0001"], ["products_cache", "0001"], ["transactions", "0001"], ["balance_ledger", "0001"], ["provider_webhook_events", "0001"],
  ["app_settings", "0003"], ["admin_audit_log", "0003"],
  ["topup_banks", "0004"], ["topup_requests", "0004"], ["topup_transfers", "0004"],
  ["rate_limits", "0005"],
  ["invite_codes", "0007"],
  ["diagnostic_logs", "0009"],
];

export function missingMigrations(missingTables: readonly string[], missingFunctions: ReadonlyArray<readonly [string, string]> = []): string[] {
  const set = new Set<string>();
  for (const t of missingTables) {
    const m = EXPECTED_TABLES.find(([name]) => name === t)?.[1];
    if (m) set.add(m);
  }
  for (const [, m] of missingFunctions) set.add(m);
  return [...set].sort();
}

// ------------------------------------------------------------------------------------------------------- environment

export interface EnvItem { name: string; level: "required" | "optional"; state: "ok" | "missing" | "invalid" | "warn"; note: string }

/** Decodes the `role` claim of a Supabase JWT key WITHOUT verifying it (only to detect swapped keys). */
export function jwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = JSON.parse(Buffer.from((parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { role?: unknown };
    return typeof json.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}

function keyKind(key: string): "anon" | "service" | "unknown" {
  if (key.startsWith("sb_publishable_")) return "anon";
  if (key.startsWith("sb_secret_")) return "service";
  const r = jwtRole(key);
  return r === "anon" ? "anon" : r === "service_role" ? "service" : "unknown";
}

const isHttpsUrl = (v: string) => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

export function envFindings(env: Record<string, string | undefined>): { items: EnvItem[]; status: DiagStatus } {
  const get = (n: string) => (env[n] ?? "").trim();
  const items: EnvItem[] = [];
  const push = (i: EnvItem) => items.push(i);
  const len = (v: string) => `terisi (${v.length} karakter)`;

  const url = get("NEXT_PUBLIC_SUPABASE_URL");
  if (!url) push({ name: "NEXT_PUBLIC_SUPABASE_URL", level: "required", state: "missing", note: "KOSONG" });
  else if (!isHttpsUrl(url)) push({ name: "NEXT_PUBLIC_SUPABASE_URL", level: "required", state: "invalid", note: "bukan URL https yang valid (contoh: https://xxxx.supabase.co)" });
  else if (/\/(rest|auth)\/v1\/?$|\/$/.test(url)) push({ name: "NEXT_PUBLIC_SUPABASE_URL", level: "required", state: "warn", note: "jangan diakhiri garis miring atau /rest/v1; cukup https://xxxx.supabase.co" });
  else push({ name: "NEXT_PUBLIC_SUPABASE_URL", level: "required", state: "ok", note: `terisi (${new URL(url).host})` });

  const anon = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const svc = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!anon) push({ name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", level: "required", state: "missing", note: "KOSONG" });
  else if (keyKind(anon) === "service") push({ name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", level: "required", state: "invalid", note: "ini ternyata KEY SERVICE ROLE (rahasia). Tertukar! Ganti dengan anon/publishable key." });
  else push({ name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", level: "required", state: "ok", note: len(anon) });

  if (!svc) push({ name: "SUPABASE_SERVICE_ROLE_KEY", level: "required", state: "missing", note: "KOSONG" });
  else if (svc.length < 20) push({ name: "SUPABASE_SERVICE_ROLE_KEY", level: "required", state: "invalid", note: "terlalu pendek (minimal 20 karakter)" });
  else if (keyKind(svc) === "anon") push({ name: "SUPABASE_SERVICE_ROLE_KEY", level: "required", state: "invalid", note: "ini ternyata ANON key. Tertukar! Ganti dengan service_role/secret key." });
  else if (anon && svc === anon) push({ name: "SUPABASE_SERVICE_ROLE_KEY", level: "required", state: "invalid", note: "sama dengan anon key. Tertukar!" });
  else push({ name: "SUPABASE_SERVICE_ROLE_KEY", level: "required", state: "ok", note: len(svc) });

  const wh = get("WEBHOOK_SECRET");
  const cron = get("CRON_SECRET");
  push(!wh ? { name: "WEBHOOK_SECRET", level: "required", state: "missing", note: "KOSONG" }
    : wh.length < 24 ? { name: "WEBHOOK_SECRET", level: "required", state: "invalid", note: `terlalu pendek (${wh.length}; minimal 24)` }
    : /[^A-Za-z0-9_-]/.test(wh) ? { name: "WEBHOOK_SECRET", level: "required", state: "warn", note: `${len(wh)}, tapi berisi karakter khusus yang bisa merusak URL. Pakai huruf/angka saja (openssl rand -hex 32)` }
    : { name: "WEBHOOK_SECRET", level: "required", state: "ok", note: len(wh) });
  push(!cron ? { name: "CRON_SECRET", level: "required", state: "missing", note: "KOSONG" }
    : cron.length < 16 ? { name: "CRON_SECRET", level: "required", state: "invalid", note: `terlalu pendek (${cron.length}; minimal 16)` }
    : cron === wh ? { name: "CRON_SECRET", level: "required", state: "warn", note: `${len(cron)}, tapi SAMA dengan WEBHOOK_SECRET. Pakai nilai berbeda.` }
    : { name: "CRON_SECRET", level: "required", state: "ok", note: len(cron) });

  const base = get("KHFYPAY_BASE_URL");
  if (!base) push({ name: "KHFYPAY_BASE_URL", level: "optional", state: "missing", note: "kosong (perlu diisi untuk tes KhfyPay: https://panel.khfy-store.com/api_v2)" });
  else if (!isHttpsUrl(base)) push({ name: "KHFYPAY_BASE_URL", level: "optional", state: "invalid", note: "bukan URL https yang valid" });
  else if (/\/$/.test(base)) push({ name: "KHFYPAY_BASE_URL", level: "optional", state: "warn", note: "jangan diakhiri garis miring" });
  else if (!/\/api_v\d+$/.test(new URL(base).pathname)) push({ name: "KHFYPAY_BASE_URL", level: "optional", state: "warn", note: `terisi (${base}), tapi biasanya berakhir di /api_v2: https://panel.khfy-store.com/api_v2` });
  else push({ name: "KHFYPAY_BASE_URL", level: "optional", state: "ok", note: `terisi (${base})` });

  const key = get("KHFYPAY_API_KEY");
  push(!key ? { name: "KHFYPAY_API_KEY", level: "optional", state: "missing", note: "kosong (perlu diisi untuk tes KhfyPay)" }
    : key !== env.KHFYPAY_API_KEY ? { name: "KHFYPAY_API_KEY", level: "optional", state: "warn", note: `${len(key)}, tapi ada spasi/baris baru di awal atau akhir. Hapus spasinya.` }
    : { name: "KHFYPAY_API_KEY", level: "optional", state: "ok", note: len(key) });

  const to = env.KHFYPAY_TIMEOUT_MS;
  if (to) {
    const n = Number(to);
    push(Number.isInteger(n) && n >= 1000 && n <= 60000 ? { name: "KHFYPAY_TIMEOUT_MS", level: "optional", state: "ok", note: `${n} ms` }
      : { name: "KHFYPAY_TIMEOUT_MS", level: "optional", state: "invalid", note: "harus angka bulat 1000–60000" });
  }

  const setup = get("SETUP_SECRET");
  if (setup) push({ name: "SETUP_SECRET", level: "optional", state: "warn", note: "masih terisi. Hapus setelah admin pertama jadi (halaman /setup sudah mati sendiri jika admin ada)." });

  const missingReq = items.some((i) => i.level === "required" && (i.state === "missing" || i.state === "invalid"));
  const anyWarn = items.some((i) => i.state === "warn" || i.state === "invalid" || (i.level === "optional" && i.state === "missing"));
  return { items, status: missingReq ? "fail" : anyWarn ? "warn" : "pass" };
}
