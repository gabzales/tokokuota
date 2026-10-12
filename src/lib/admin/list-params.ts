import { z } from "zod";

export const PAGE = 25;

const text = z.string().trim().max(80).optional().catch(undefined);
const page = z.coerce.number().int().min(1).max(100000).catch(1);
const tri = z.enum(["true", "false"]).optional().catch(undefined).transform((v) => (v === undefined ? undefined : v === "true"));

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = (sp: SP, ...keys: string[]) => Object.fromEntries(keys.map((k) => [k, first(sp[k])]));

export const parseUserFilters = (sp: SP) =>
  z.object({ q: text, role: z.enum(["user", "admin"]).optional().catch(undefined), active: tri, page })
    .transform((v) => ({ ...v, q: v.q || undefined }))
    .parse(pick(sp, "q", "role", "active", "page"));

export const parseTxFilters = (sp: SP) =>
  z.object({
    q: text,
    status: z.enum(["PENDING", "SUCCESS", "FAILED"]).optional().catch(undefined),
    view: z.enum(["review", "unsent", "stale"]).optional().catch(undefined),
    user: z.string().uuid().optional().catch(undefined),
    page,
  })
    .transform((v) => ({ ...v, q: v.q || undefined }))
    .parse(pick(sp, "q", "status", "view", "user", "page"));

export const parseLedgerFilters = (sp: SP) =>
  z.object({
    q: text,
    type: z.enum(["PURCHASE", "REFUND", "MANUAL_TOPUP", "ADJUSTMENT"]).optional().catch(undefined),
    user: z.string().uuid().optional().catch(undefined),
    page,
  })
    .transform((v) => ({ ...v, q: v.q || undefined }))
    .parse(pick(sp, "q", "type", "user", "page"));

export const parseProductFilters = (sp: SP) =>
  z.object({ q: text, category: text, active: tri, page })
    .transform((v) => ({ ...v, q: v.q || undefined, category: v.category || undefined }))
    .parse(pick(sp, "q", "category", "active", "page"));

export const parseTopupFilters = (sp: SP) =>
  z.object({
    view: z.enum(["requests", "queue"]).catch("requests"),
    status: z.enum(["PENDING", "PAID", "EXPIRED", "CANCELLED", "QUEUED", "CREDITED", "RESOLVED", "IGNORED"]).optional().catch(undefined),
    q: text,
    page,
  })
    .transform((v) => ({ ...v, q: v.q || undefined }))
    .parse(pick(sp, "view", "status", "q", "page"));

export const parsePage = (sp: SP) => page.parse(first(sp.page));

/** Query-string builder that keeps the current filters and drops empty values. */
export function withParams(base: string, current: Record<string, unknown>, over: Record<string, unknown> = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...over })) {
    if (v === undefined || v === null || v === "" || (k === "page" && Number(v) <= 1)) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export function pageSlice<T>(rows: T[]) {
  return { rows: rows.slice(0, PAGE), hasNext: rows.length > PAGE };
}

/** Start of "today" in Asia/Jakarta (UTC+7, no DST) as an ISO instant. */
export function startOfTodayJakarta(now = new Date()): string {
  const j = new Date(now.getTime() + 7 * 3600_000);
  j.setUTCHours(0, 0, 0, 0);
  return new Date(j.getTime() - 7 * 3600_000).toISOString();
}
