import { z } from "zod";

export interface PublicSettings {
  maintenance_mode: boolean;
  announcement: string;
  support_contact: string;
}

export const SETTINGS_TAG = "settings";

/** Form schema for the settings page (mirrors the checks inside admin_update_settings). */
const intField = (max = 1_000_000_000) => z.string().trim().min(1, "Wajib diisi").pipe(z.coerce.number().int().min(0).max(max));

export const settingsFormSchema = z.object({
  topup_enabled: z.enum(["true", "false"]).transform((v) => v === "true"),
  topup_min_amount: z.string().trim().min(1, "Wajib diisi").pipe(z.coerce.number().int().min(1).max(1_000_000_000)),
  topup_max_amount: z.string().trim().min(1, "Wajib diisi").pipe(z.coerce.number().int().min(1).max(1_000_000_000)),
  topup_code_min: intField(9999),
  topup_code_max: intField(9999),
  topup_expiry_minutes: z.string().trim().min(1, "Wajib diisi").pipe(z.coerce.number().int().min(5).max(10080)),
  maintenance_mode: z.enum(["true", "false"]).transform((v) => v === "true"),
  catalog_activate_new: z.enum(["true", "false"]).transform((v) => v === "true"),
  // "" must be rejected, not coerced to 0
  catalog_default_margin: z.string().trim().min(1).pipe(z.coerce.number().int().min(0).max(1_000_000_000)),
  support_contact: z.string().trim().max(100),
  announcement: z.string().trim().max(300),
});

export interface TopupSettings {
  enabled: boolean; min: number; max: number; codeMin: number; codeMax: number; expiryMinutes: number;
}

export function toTopupSettings(rows: { key: string; value: unknown }[]): TopupSettings {
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const n = (k: string, d: number) => { const v = m.get(k); return typeof v === "number" && Number.isInteger(v) ? v : d; };
  return {
    enabled: m.get("topup_enabled") === true,
    min: n("topup_min_amount", 10000), max: n("topup_max_amount", 2000000),
    codeMin: n("topup_code_min", 1), codeMax: n("topup_code_max", 999), expiryMinutes: n("topup_expiry_minutes", 1440),
  };
}

const asBool = (v: unknown) => v === true;
const asStr = (v: unknown) => (typeof v === "string" ? v : "");

export function toPublicSettings(rows: { key: string; value: unknown }[]): PublicSettings {
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return {
    maintenance_mode: asBool(m.get("maintenance_mode")),
    announcement: asStr(m.get("announcement")),
    support_contact: asStr(m.get("support_contact")),
  };
}

export function toSyncOptions(rows: { key: string; value: unknown }[]) {
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const margin = m.get("catalog_default_margin");
  return {
    defaultMargin: typeof margin === "number" && Number.isInteger(margin) && margin >= 0 ? margin : 0,
    activateNew: asBool(m.get("catalog_activate_new")),
  };
}
