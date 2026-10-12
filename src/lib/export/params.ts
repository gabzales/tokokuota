import { z } from "zod";

export const EXPORT_MAX_ROWS = 10_000;
const DAY = 86_400_000;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Today / N days ago as YYYY-MM-DD in Asia/Jakarta (UTC+7, no DST). */
export function jakartaDate(daysAgo = 0, now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000 - daysAgo * DAY).toISOString().slice(0, 10);
}

export type ExportParams =
  | { ok: true; fromIso: string; toIso: string; from: string; to: string; status?: string; type?: string }
  | { ok: false; error: string };

/** Dates are Jakarta calendar days; `to` is inclusive. Max range 366 days (the database enforces it too). */
export function parseExportParams(sp: URLSearchParams, now = new Date()): ExportParams {
  const from = sp.get("from") || jakartaDate(30, now);
  const to = sp.get("to") || jakartaDate(0, now);
  if (!date.safeParse(from).success || !date.safeParse(to).success) return { ok: false, error: "Format tanggal harus YYYY-MM-DD" };
  const start = new Date(`${from}T00:00:00+07:00`);
  const endExclusive = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + DAY);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())) return { ok: false, error: "Tanggal tidak valid" };
  if (endExclusive <= start) return { ok: false, error: "Tanggal akhir harus sama atau setelah tanggal awal" };
  if (endExclusive.getTime() - start.getTime() > 366 * DAY) return { ok: false, error: "Rentang maksimal 366 hari" };
  const status = z.enum(["PENDING", "SUCCESS", "FAILED"]).safeParse(sp.get("status") || undefined);
  const type = z.enum(["PURCHASE", "REFUND", "MANUAL_TOPUP", "TOPUP", "ADJUSTMENT"]).safeParse(sp.get("type") || undefined);
  return { ok: true, from, to, fromIso: start.toISOString(), toIso: endExclusive.toISOString(), status: status.success ? status.data : undefined, type: type.success ? type.data : undefined };
}
