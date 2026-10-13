export const DIAG_CHECKS = [
  { id: "env", title: "Konfigurasi environment" },
  { id: "supabase", title: "Supabase: koneksi + migrasi" },
  { id: "khfy_network", title: "KhfyPay: server terjangkau (cek_stock_akrab)" },
  { id: "khfy_key", title: "KhfyPay: API key diterima (history)" },
  { id: "khfy_products", title: "KhfyPay: ambil sample list_product" },
  { id: "webhook", title: "Webhook: endpoint sendiri (loopback)" },
] as const;

export type DiagCheckId = (typeof DIAG_CHECKS)[number]["id"];
export const isDiagCheckId = (v: unknown): v is DiagCheckId => DIAG_CHECKS.some((c) => c.id === v);

export type DiagStatus = "pass" | "warn" | "fail" | "skip";

/** Everything here is already redacted: it is sent to the browser, stored in diagnostic_logs and printed to server logs. */
export interface DiagResult {
  id: DiagCheckId;
  title: string;
  status: DiagStatus;
  /** Stable machine-readable code, e.g. HTTP_401, NET_DNS, SB_MIGRATION_MISSING. */
  code: string;
  summary: string;
  hint?: string;
  httpStatus?: number;
  latencyMs?: number;
  /** Request line + raw response / error details, for copy-paste. */
  detail?: string;
  ranAt: string;
}

export type Verdict = { status: DiagStatus; code: string; summary: string; hint?: string };
