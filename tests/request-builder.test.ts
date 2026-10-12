import { describe, expect, it } from "vitest";
import { ProviderNotConfiguredError } from "@/lib/providers/khfypay/errors";
import {
  assertTrxRequestBuildable,
  buildCekStockAkrabRequest,
  buildHistoryRequest,
  buildListProductRequest,
  buildTrxRequest,
} from "@/lib/providers/khfypay/request-builder";
import { KHFYPAY_WIRE, type KhfyPayWire } from "@/lib/providers/khfypay/wire";

const cfg = { baseUrl: "https://provider.example/api/", apiKey: "SECRET-KEY-123", timeoutMs: 1000 };
const trx = { reffId: "TKABC", productCode: "PC1", destination: "08123456789" };
const incomplete: KhfyPayWire = {
  ...KHFYPAY_WIRE,
  trx: { reffId: "reff_id", productCode: null, destination: null },
};

describe("official KhfyPay parameters", () => {
  it("/trx uses produk, tujuan, reff_id, api_key", () => {
    const u = new URL(buildTrxRequest(cfg, KHFYPAY_WIRE, trx).url);
    expect(u.pathname).toBe("/api/trx");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      api_key: "SECRET-KEY-123", produk: "PC1", tujuan: "08123456789", reff_id: "TKABC",
    });
  });

  it("/history is a lookup by refid with api_key, nothing else (no date/pagination)", () => {
    const u = new URL(buildHistoryRequest(cfg, KHFYPAY_WIRE, { reffId: "TKABC" }).url);
    expect(u.pathname).toBe("/api/history");
    expect(Object.fromEntries(u.searchParams)).toEqual({ api_key: "SECRET-KEY-123", refid: "TKABC" });
  });

  it("/list_product sends api_key; /cek_stock_akrab sends NO undocumented parameters", () => {
    expect(Object.fromEntries(new URL(buildListProductRequest(cfg, KHFYPAY_WIRE).url).searchParams)).toEqual({ api_key: "SECRET-KEY-123" });
    const stock = buildCekStockAkrabRequest(cfg, KHFYPAY_WIRE);
    expect([...new URL(stock.url).searchParams.keys()]).toEqual([]);
    expect(stock.url).not.toContain("SECRET-KEY-123");
  });

  it("documented endpoint paths, no double slashes", () => {
    expect(new URL(buildListProductRequest(cfg, KHFYPAY_WIRE).url).pathname).toBe("/api/list_product");
    expect(new URL(buildCekStockAkrabRequest(cfg, KHFYPAY_WIRE).url).pathname).toBe("/api_v3/cek_stock_akrab");
  });

  it("with the real base URL (…/api_v2) history is /api_v2/history and cek_stock_akrab stays /api_v3/…", () => {
    const real = { baseUrl: "https://panel.khfy-store.com/api_v2", apiKey: "SECRET-KEY-123", timeoutMs: 1000 };
    const h = new URL(buildHistoryRequest(real, KHFYPAY_WIRE, { reffId: "123e4567-e89b-12d3-a456-426614174000" }).url);
    expect(`${h.origin}${h.pathname}`).toBe("https://panel.khfy-store.com/api_v2/history");
    expect(h.searchParams.get("refid")).toBe("123e4567-e89b-12d3-a456-426614174000");
    const s = new URL(buildCekStockAkrabRequest(real, KHFYPAY_WIRE).url);
    expect(`${s.origin}${s.pathname}`).toBe("https://panel.khfy-store.com/api_v3/cek_stock_akrab");
  });

  it("the same reff_id is sent unchanged on every retry", () => {
    expect(buildTrxRequest(cfg, KHFYPAY_WIRE, trx).url).toBe(buildTrxRequest(cfg, KHFYPAY_WIRE, trx).url);
  });
});

describe("safety", () => {
  it("redacts the API key in the loggable URL", () => {
    const r = buildTrxRequest(cfg, KHFYPAY_WIRE, trx);
    expect(r.url).toContain("SECRET-KEY-123");
    expect(r.redactedUrl).not.toContain("SECRET-KEY-123");
    expect(r.redactedUrl).toContain("api_key=***");
  });

  it("refuses to build when a wire detail is missing (no guessing)", () => {
    expect(() => buildTrxRequest(cfg, incomplete, trx)).toThrow(ProviderNotConfiguredError);
    try { buildTrxRequest(cfg, incomplete, trx); expect.unreachable(); }
    catch (e) { expect((e as ProviderNotConfiguredError).missing).toEqual(["trx.productCode parameter name", "trx.destination parameter name"]); }
    expect(() => buildListProductRequest(cfg, { ...KHFYPAY_WIRE, apiKey: null })).toThrow(/apiKey/);
  });

  it("assertTrxRequestBuildable: passes with the real wire, throws when config is bad, sends nothing", () => {
    expect(() => assertTrxRequestBuildable(cfg, KHFYPAY_WIRE)).not.toThrow();
    expect(() => assertTrxRequestBuildable(cfg, incomplete)).toThrow(ProviderNotConfiguredError);
    expect(() => assertTrxRequestBuildable({ ...cfg, baseUrl: "http://provider.example" }, KHFYPAY_WIRE)).toThrow(/https/);
  });

  it("will not send the key over plain http (except localhost)", () => {
    expect(() => buildListProductRequest({ ...cfg, baseUrl: "http://provider.example" }, KHFYPAY_WIRE)).toThrow(/https/);
    expect(() => buildListProductRequest({ ...cfg, baseUrl: "http://localhost:4000" }, KHFYPAY_WIRE)).not.toThrow();
  });

  it("URL-encodes odd values instead of letting them inject parameters", () => {
    const u = new URL(buildTrxRequest(cfg, KHFYPAY_WIRE, { ...trx, destination: "1&api_key=evil" }).url);
    expect(u.searchParams.get("tujuan")).toBe("1&api_key=evil");
    expect(u.searchParams.getAll("api_key")).toEqual(["SECRET-KEY-123"]);
  });
});
