import { describe, expect, it, vi } from "vitest";
import { categoriesOf, filterCatalog, PAGE_SIZE } from "@/lib/catalog/filter";
import { toCatalogProducts } from "@/lib/catalog/products";
import { CatalogValidationError, normalizeProducts } from "@/lib/catalog/normalize";
import { syncCatalog } from "@/lib/catalog/sync";
import type { ProviderCall, ProviderProduct } from "@/lib/providers/types";
import { fakeProvider, fakeRpc } from "./helpers";

const raw = { httpStatus: 200, contentType: null, bodyText: "", json: undefined };
const p = (over: Partial<ProviderProduct> = {}): ProviderProduct => ({ providerCode: "A1", name: "Paket A", category: "data", costPrice: 9000, isAvailable: true, raw: { any: 1 }, ...over });
const sync = (res: ProviderCall<ProviderProduct[]>, rpc = fakeRpc()) =>
  syncCatalog({ provider: fakeProvider({ listProducts: vi.fn(async () => res) }), rpc, defaultMargin: 500, activateNew: false }).then((r) => ({ r, rpc }));

describe("normalizeProducts (boundary)", () => {
  it("maps to DB rows", () => {
    expect(normalizeProducts([p({ category: "" })])).toEqual([{ provider_code: "A1", name: "Paket A", category: null, cost_price: 9000, is_available: true, raw: { any: 1 } }]);
  });
  it("rejects the whole batch on any bad item", () => {
    for (const bad of [p({ costPrice: 1.5 }), p({ costPrice: -1 }), p({ name: "" }), p({ providerCode: " " }), p({ costPrice: NaN })]) {
      expect(() => normalizeProducts([p({ providerCode: "OK" }), bad])).toThrow(CatalogValidationError);
    }
    expect(() => normalizeProducts([])).toThrow(/empty/);
    expect(() => normalizeProducts([p(), p()])).toThrow(/duplicate/);
  });
});

describe("syncCatalog fails closed", () => {
  it("unparsed (current state: parser is TODO) => nothing written", async () => {
    const { r, rpc } = await sync({ kind: "unparsed", raw });
    expect(r).toEqual({ status: "SKIPPED_UNPARSED" });
    expect(rpc.syncProducts).not.toHaveBeenCalled();
  });
  it("transport error => nothing written", async () => {
    const { r, rpc } = await sync({ kind: "transport_error", reason: "timeout" });
    expect(r).toEqual({ status: "SKIPPED_TRANSPORT", reason: "timeout" });
    expect(rpc.syncProducts).not.toHaveBeenCalled();
  });
  it("invalid / empty data => rejected, nothing written", async () => {
    expect((await sync({ kind: "ok", data: [p({ costPrice: -5 })], raw })).rpc.syncProducts).not.toHaveBeenCalled();
    expect((await sync({ kind: "ok", data: [], raw })).r.status).toBe("REJECTED_INVALID");
  });
  it("valid data => RPC with the margin/activation options", async () => {
    const { r, rpc } = await sync({ kind: "ok", data: [p()], raw });
    expect(r).toEqual({ status: "SYNCED", inserted: 1, updated: 0 });
    expect(rpc.syncProducts).toHaveBeenCalledWith(expect.objectContaining({ provider: "khfypay", defaultMargin: 500, activateNew: false }));
  });
});

describe("catalog filter/pagination", () => {
  const all = Array.from({ length: 60 }, (_, i) => ({ id: String(i), name: i % 2 ? `Data ${i}` : `Pulsa ${i}`, category: i % 2 ? "data" : "pulsa", description: null, sell_price: 1000 + i, is_available: true }));
  it("filters by query and category, paginates", () => {
    expect(filterCatalog(all, { q: "pulsa" }).total).toBe(30);
    expect(filterCatalog(all, { category: "data" }).items.every((x) => x.category === "data")).toBe(true);
    const page2 = filterCatalog(all, { page: 2 });
    expect(page2.items).toHaveLength(PAGE_SIZE);
    expect(page2.items[0]!.id).toBe(String(PAGE_SIZE));
    expect(filterCatalog(all, { page: 3 })).toMatchObject({ hasNext: false });
    expect(filterCatalog(all, { page: -5 }).page).toBe(1);
  });
  it("lists categories once, sorted", () => {
    expect(categoriesOf(all)).toEqual(["data", "pulsa"]);
  });
});

describe("toCatalogProducts: app-owned display metadata wins, then sort order", () => {
  const row = (o: Partial<Parameters<typeof toCatalogProducts>[0][number]>) => ({
    id: "i", name: "Provider Name", display_name: null, category: "prov", display_category: null,
    description: null, sort_order: 0, sell_price: 1000, is_available: true, ...o,
  });
  it("display_name / display_category override the provider's; null falls back", () => {
    const [a, b] = toCatalogProducts([row({ id: "a", display_name: "Nama Kita", display_category: "Kuota" }), row({ id: "b" })]);
    expect(a).toMatchObject({ id: "a", name: "Nama Kita", category: "Kuota" });
    expect(b).toMatchObject({ id: "b", name: "Provider Name", category: "prov" });
  });
  it("orders by sort_order, then by displayed name", () => {
    const out = toCatalogProducts([row({ id: "z", name: "Zeta" }), row({ id: "a", name: "Alpha" }), row({ id: "first", name: "Zzz", sort_order: -1 })]);
    expect(out.map((p) => p.id)).toEqual(["first", "a", "z"]);
  });
});
