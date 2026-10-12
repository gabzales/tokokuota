import { describe, expect, it, vi } from "vitest";
import { KhfyPayAdapter } from "@/lib/providers/khfypay/adapter";
import { ProviderNotConfiguredError } from "@/lib/providers/khfypay/errors";
import { KHFYPAY_WIRE, type KhfyPayWire } from "@/lib/providers/khfypay/wire";

const cfg = { baseUrl: "https://provider.example", apiKey: "SECRET", timeoutMs: 30 };
const input = { reffId: "TK1", productCode: "PC", destination: "0812345678" };
const json = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
const incomplete: KhfyPayWire = { ...KHFYPAY_WIRE, apiKey: null };

describe("KhfyPayAdapter", () => {
  it("assertReady passes with the official wire, throws when incomplete", () => {
    expect(() => new KhfyPayAdapter(cfg).assertReady()).not.toThrow();
    expect(() => new KhfyPayAdapter(cfg, { wire: incomplete }).assertReady()).toThrow(ProviderNotConfiguredError);
  });

  it("never touches the network when the request cannot be built", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const a = new KhfyPayAdapter(cfg, { fetchImpl, wire: incomplete });
    await expect(a.createTransaction(input)).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the official /trx and /history parameters", async () => {
    const fetchImpl = json({ any: 1 });
    const a = new KhfyPayAdapter(cfg, { fetchImpl });
    await a.createTransaction(input);
    await a.getHistory({ reffId: "TK1" });
    const urls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => new URL(c[0] as string));
    expect(urls[0]!.pathname).toBe("/trx");
    expect(urls[0]!.searchParams.get("produk")).toBe("PC");
    expect(urls[0]!.searchParams.get("tujuan")).toBe("0812345678");
    expect(urls[0]!.searchParams.get("reff_id")).toBe("TK1");
    expect(urls[1]!.pathname).toBe("/history");
    expect(urls[1]!.searchParams.get("refid")).toBe("TK1");
  });

  it("fails closed: unknown response bodies come back `unparsed` with the raw body, never invented fields", async () => {
    const a = new KhfyPayAdapter(cfg, { fetchImpl: json({ anything: [1, 2] }) });
    const r = await a.listProducts();
    expect(r.kind).toBe("unparsed");
    if (r.kind === "unparsed") expect(r.raw.json).toEqual({ anything: [1, 2] });
    expect((await a.getHistory({ reffId: "TK1" })).kind).toBe("unparsed");
  });

  it("/trx timeout => transport_uncertain (never a failure)", async () => {
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))))) as typeof fetch;
    const out = await new KhfyPayAdapter(cfg, { fetchImpl: hang }).createTransaction(input);
    expect(out).toEqual({ kind: "transport_uncertain", reason: "timeout", httpStatus: undefined });
  });

  it("/trx 5xx => transport_uncertain; 200 => response with parsed=null", async () => {
    const e500 = (async () => new Response("x", { status: 500 })) as typeof fetch;
    expect((await new KhfyPayAdapter(cfg, { fetchImpl: e500 }).createTransaction(input)).kind).toBe("transport_uncertain");
    const out = await new KhfyPayAdapter(cfg, { fetchImpl: json({ result: 0 }) }).createTransaction(input);
    expect(out.kind).toBe("response");
    if (out.kind === "response") expect(out.parsed).toBeNull();
  });
});
