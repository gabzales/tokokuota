import { describe, expect, it } from "vitest";
import { isActiveAdmin } from "@/lib/admin/guard";
import { PAGE, pageSlice, parseLedgerFilters, parseProductFilters, parseTxFilters, parseUserFilters, startOfTodayJakarta, withParams } from "@/lib/admin/list-params";
import { createAdminMutations, describeAdminError } from "@/lib/admin/rpc";
import { bulkMarginSchema, productUpdateSchema, resolveReviewSchema, topupSchema, userFlagsSchema } from "@/lib/admin/schemas";
import { RpcError, type RpcCaller } from "@/lib/transactions/rpc";
import { settingsFormSchema, toPublicSettings, toSyncOptions } from "@/lib/settings/keys";

const U = "11111111-1111-4111-8111-111111111111";

describe("isActiveAdmin", () => {
  it("only an active admin passes", () => {
    expect(isActiveAdmin({ role: "admin", is_active: true })).toBe(true);
    for (const p of [null, undefined, {}, { role: "user", is_active: true }, { role: "admin", is_active: false }, { role: "admin" }, { role: "ADMIN", is_active: true }]) {
      expect(isActiveAdmin(p as never)).toBe(false);
    }
  });
});

describe("admin form schemas", () => {
  const prod = { productId: U, margin: "1500", is_active: "true", display_name: "  Paket  ", display_category: "", sort_order: "3", description: "" };
  it("product: parses, trims, coerces", () => {
    expect(productUpdateSchema.parse(prod)).toMatchObject({ margin: 1500, is_active: true, display_name: "Paket", sort_order: 3 });
  });
  it("product: rejects negative / fractional / absurd margin and bad ids", () => {
    for (const margin of ["-1", "1.5", "abc", "2000000000", "", "   "]) expect(productUpdateSchema.safeParse({ ...prod, margin }).success).toBe(false);
    expect(productUpdateSchema.safeParse({ ...prod, productId: "x" }).success).toBe(false);
    expect(productUpdateSchema.safeParse({ ...prod, is_active: "maybe" }).success).toBe(false);
  });
  it("product: cost_price / provider fields can never be submitted", () => {
    const out = productUpdateSchema.parse({ ...prod, cost_price: "1", name: "x", provider_code: "y" });
    expect(Object.keys(out)).not.toContain("cost_price");
    expect(Object.keys(out)).not.toContain("provider_code");
  });
  it("bulk margin: mode/value limits", () => {
    const ok = { mode: "PERCENT", value: "10", category: "", onlyActive: "false" };
    expect(bulkMarginSchema.safeParse(ok).success).toBe(true);
    expect(bulkMarginSchema.safeParse({ ...ok, value: "1001" }).success).toBe(false);
    expect(bulkMarginSchema.safeParse({ ...ok, mode: "FLAT", value: "1001" }).success).toBe(true);
    expect(bulkMarginSchema.safeParse({ ...ok, mode: "NOPE" }).success).toBe(false);
    expect(bulkMarginSchema.safeParse({ ...ok, value: "-5" }).success).toBe(false);
    expect(bulkMarginSchema.safeParse({ ...ok, value: "" }).success).toBe(false); // empty is not 0
  });
  it("top-up: positive integer rupiah, capped, needs an idempotency key", () => {
    const ok = { userId: U, amount: "50000", note: " bonus ", idempotencyKey: U };
    expect(topupSchema.parse(ok)).toMatchObject({ amount: 50000, note: "bonus" });
    for (const amount of ["0", "-1", "1.5", "1000000001", "abc", ""]) expect(topupSchema.safeParse({ ...ok, amount }).success).toBe(false);
    expect(topupSchema.safeParse({ ...ok, idempotencyKey: "short" }).success).toBe(false);
  });
  it("user flags: role whitelist", () => {
    expect(userFlagsSchema.safeParse({ userId: U, is_active: "false", role: "admin" }).success).toBe(true);
    expect(userFlagsSchema.safeParse({ userId: U, is_active: "true", role: "root" }).success).toBe(false);
  });
  it("resolve review: note required", () => {
    expect(resolveReviewSchema.safeParse({ reffId: "TKAAAAAAAAAAAAAAAAAA", note: "ok" }).success).toBe(false);
    expect(resolveReviewSchema.safeParse({ reffId: "TKAAAAAAAAAAAAAAAAAA", note: "sudah dicek" }).success).toBe(true);
    expect(resolveReviewSchema.safeParse({ reffId: "bad id!", note: "sudah dicek" }).success).toBe(false);
  });
  it("settings form", () => {
    const ok = { maintenance_mode: "true", catalog_activate_new: "false", catalog_default_margin: "500", support_contact: " wa ", announcement: "",
      topup_enabled: "true", topup_min_amount: "10000", topup_max_amount: "2000000", topup_code_min: "1", topup_code_max: "999", topup_expiry_minutes: "1440" };
    expect(settingsFormSchema.parse(ok)).toMatchObject({ maintenance_mode: true, catalog_activate_new: false, catalog_default_margin: 500, support_contact: "wa" });
    expect(settingsFormSchema.safeParse({ ...ok, announcement: "x".repeat(301) }).success).toBe(false);
    expect(settingsFormSchema.safeParse({ ...ok, catalog_default_margin: "-1" }).success).toBe(false);
    expect(settingsFormSchema.safeParse({ ...ok, catalog_default_margin: "" }).success).toBe(false);
    for (const k of ["topup_min_amount", "topup_max_amount", "topup_code_min", "topup_code_max", "topup_expiry_minutes"]) {
      expect(settingsFormSchema.safeParse({ ...ok, [k]: "" }).success).toBe(false); // empty is never 0
    }
    expect(settingsFormSchema.safeParse({ ...ok, topup_expiry_minutes: "1" }).success).toBe(false);
    expect(settingsFormSchema.safeParse({ ...ok, topup_code_max: "10000" }).success).toBe(false);
    expect(settingsFormSchema.parse(ok)).toMatchObject({ topup_enabled: true, topup_min_amount: 10000, topup_expiry_minutes: 1440 });
  });
});

describe("settings mapping", () => {
  it("public subset never includes sync options; bad values fall back safely", () => {
    const rows = [{ key: "maintenance_mode", value: true }, { key: "announcement", value: "Halo" }, { key: "catalog_default_margin", value: 900 }];
    expect(toPublicSettings(rows)).toEqual({ maintenance_mode: true, announcement: "Halo", support_contact: "" });
    expect(toSyncOptions(rows)).toEqual({ defaultMargin: 900, activateNew: false });
    expect(toSyncOptions([{ key: "catalog_default_margin", value: -5 }, { key: "catalog_activate_new", value: "yes" }])).toEqual({ defaultMargin: 0, activateNew: false });
    expect(toPublicSettings([])).toEqual({ maintenance_mode: false, announcement: "", support_contact: "" });
  });
});

describe("list params", () => {
  it("invalid filter values fall back instead of throwing or reaching SQL", () => {
    const f = parseTxFilters({ status: "HACK", view: "x", user: "not-a-uuid", page: "-3", q: "  abc  " });
    expect(f).toEqual({ q: "abc", status: undefined, view: undefined, user: undefined, page: 1 });
    expect(parseUserFilters({ role: "root", active: "maybe", page: "abc" })).toEqual({ q: undefined, role: undefined, active: undefined, page: 1 });
    expect(parseLedgerFilters({ type: "DROP" }).type).toBeUndefined();
    expect(parseProductFilters({ active: "true", page: "2" })).toMatchObject({ active: true, page: 2 });
    expect(parseUserFilters({ q: "x".repeat(200) }).q).toBeUndefined();
  });
  it("takes the first value of repeated params", () => {
    expect(parseTxFilters({ status: ["FAILED", "SUCCESS"] }).status).toBe("FAILED");
  });
  it("pageSlice uses the +1 row to detect a next page", () => {
    const many = Array.from({ length: PAGE + 1 }, (_, i) => i);
    expect(pageSlice(many)).toMatchObject({ hasNext: true });
    expect(pageSlice(many).rows).toHaveLength(PAGE);
    expect(pageSlice([1, 2]).hasNext).toBe(false);
  });
  it("withParams keeps filters, drops empties, hides page 1", () => {
    expect(withParams("/a", { q: "x", status: undefined, page: 3 }, { page: 1 })).toBe("/a?q=x");
    expect(withParams("/a", { q: "x" }, { page: 2 })).toBe("/a?q=x&page=2");
    expect(withParams("/a", {})).toBe("/a");
  });
  it("'today' starts at 00:00 Asia/Jakarta (UTC+7)", () => {
    expect(startOfTodayJakarta(new Date("2026-10-04T05:00:00Z"))).toBe("2026-10-03T17:00:00.000Z"); // 12:00 WIB on the 4th
    expect(startOfTodayJakarta(new Date("2026-10-04T18:30:00Z"))).toBe("2026-10-04T17:00:00.000Z"); // 01:30 WIB on the 5th
  });
});

describe("admin mutation wrappers", () => {
  const caller = (data: unknown, error: { message: string; code?: string } | null = null) => {
    const c: RpcCaller & { last?: [string, Record<string, unknown>] } = { rpc: async (fn, args) => { c.last = [fn, args ?? {}]; return { data, error }; } };
    return c;
  };
  it("always passes the admin id, and maps outcomes", async () => {
    const c = caller([{ out_outcome: "UPDATED", out_sell_price: 12500 }]);
    const r = await createAdminMutations(c).updateProduct({ adminId: "a", productId: "p", changes: { margin: 2500 } });
    expect(r).toEqual({ outcome: "UPDATED", sellPrice: 12500 });
    expect(c.last![1]).toMatchObject({ p_admin_id: "a", p_product_id: "p", p_changes: { margin: 2500 } });
    expect((await createAdminMutations(caller([{ out_updated: 7 }])).bulkSetMargin({ adminId: "a", mode: "FLAT", value: 1, category: null, onlyActive: false })).updated).toBe(7);
  });
  it("database errors become RpcError and then short, non-leaky messages", async () => {
    const m = createAdminMutations(caller(null, { message: "relation secret_table violates …", code: "42501" }));
    await expect(m.resolveReview({ adminId: "a", reffId: "x", note: "n" })).rejects.toBeInstanceOf(RpcError);
    expect(describeAdminError(new RpcError("f", "42501", "x"))).toBe("Akses ditolak.");
    expect(describeAdminError(new RpcError("f", "23514", "x"))).toMatch(/harga jual/i);
    expect(describeAdminError(new RpcError("f", "99999", "relation secret_table"))).not.toMatch(/secret_table/);
    expect(describeAdminError(new Error("boom"))).toBe("Terjadi gangguan. Coba lagi.");
  });
});
