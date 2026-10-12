import { describe, expect, it, vi } from "vitest";
import { checkoutErrorMessage, checkoutHttpStatus, performCheckout, type CheckoutFailureCode } from "@/lib/transactions/checkout";
import { checkoutInputSchema } from "@/lib/transactions/checkout-input";
import type { SubmitOutcome } from "@/lib/providers/types";
import { fakeProvider, fakeRpc, fakeStore, tx } from "./helpers";

const req = { userId: "u", productId: "p", destination: "081234567890", idempotencyKey: "11111111-1111-4111-8111-111111111111" };
const SECRET = "API-KEY-SECRET-VALUE";
const mk = (o: { rpc?: ReturnType<typeof fakeRpc>; store?: ReturnType<typeof fakeStore>; provider?: ReturnType<typeof fakeProvider> } = {}) => {
  const rpc = o.rpc ?? fakeRpc();
  const store = o.store ?? fakeStore();
  const provider = o.provider ?? fakeProvider();
  return { rpc, store, provider, deps: { rpc, store, provider, secrets: [SECRET] } };
};
const neverFinalized = (rpc: ReturnType<typeof fakeRpc>) => {
  expect(rpc.finalizeSuccess).not.toHaveBeenCalled();
  expect(rpc.finalizeFailed).not.toHaveBeenCalled();
};

describe("performCheckout — happy path stays PENDING", () => {
  it("reserves, CLAIMS before sending, sends once with the DB reff_id, stores raw, never finalizes", async () => {
    const order: string[] = [];
    const rpc = fakeRpc({ claimSend: vi.fn(async () => { order.push("claim"); return { claimed: true, txId: "t", reffId: "TKAAAAAAAAAAAAAAAAAA", status: "PENDING", attempts: 1 }; }) });
    const provider = fakeProvider({ createTransaction: vi.fn(async () => { order.push("send"); return { kind: "response", raw: { httpStatus: 200, contentType: null, bodyText: "ok", json: undefined }, parsed: null } as SubmitOutcome; }) });
    const { deps, store } = mk({ rpc, provider });

    const r = await performCheckout(deps, req);

    expect(r).toMatchObject({ ok: true, status: "PENDING", created: true, submission: "SUBMITTED" });
    expect(order).toEqual(["claim", "send"]);
    expect(provider.createTransaction).toHaveBeenCalledOnce();
    expect(provider.createTransaction).toHaveBeenCalledWith({ reffId: "TKAAAAAAAAAAAAAAAAAA", productCode: "PC1", destination: "081234567890" });
    expect(store.saveProviderSnapshot).toHaveBeenCalledOnce();
    neverFinalized(rpc);
  });

  it("checks the provider request is buildable BEFORE any money moves", async () => {
    const provider = fakeProvider({ assertReady: vi.fn(() => { throw new Error("cfg"); }) });
    const { deps, rpc } = mk({ provider });
    expect(await performCheckout(deps, req)).toEqual({ ok: false, code: "PROVIDER_NOT_READY" });
    expect(rpc.reserve).not.toHaveBeenCalled();
  });

  it("passes the price guard through but never a price to charge", async () => {
    const { deps, rpc } = mk();
    await performCheckout(deps, { ...req, expectedPrice: 10000 });
    expect(rpc.reserve).toHaveBeenCalledWith(expect.objectContaining({ expectedPrice: 10000 }));
    expect(Object.keys((rpc.reserve as ReturnType<typeof vi.fn>).mock.calls[0]![0]).sort()).toEqual(["destination", "expectedPrice", "idempotencyKey", "productId", "userId"]);
  });
});

describe("performCheckout — uncertainty never finalizes or refunds", () => {
  for (const reason of ["timeout", "network", "http_error"] as const) {
    it(`/trx ${reason} => PENDING/UNCERTAIN, snapshot stored, no finalize`, async () => {
      const provider = fakeProvider({ createTransaction: vi.fn(async () => ({ kind: "transport_uncertain", reason }) as SubmitOutcome) });
      const { deps, rpc, store } = mk({ provider });
      expect(await performCheckout(deps, req)).toMatchObject({ ok: true, status: "PENDING", submission: "UNCERTAIN" });
      expect(store.saveProviderSnapshot).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: "transport_uncertain", reason }));
      neverFinalized(rpc);
    });
  }

  it("even a response that LOOKS like a success/failure is not interpreted (unknown schema)", async () => {
    for (const body of ['{"result":0,"status":"success"}', '{"result":1,"message":"gagal"}']) {
      const provider = fakeProvider({ createTransaction: vi.fn(async () => ({ kind: "response", raw: { httpStatus: 200, contentType: "application/json", bodyText: body, json: JSON.parse(body) }, parsed: null }) as SubmitOutcome) });
      const { deps, rpc } = mk({ provider });
      expect(await performCheckout(deps, req)).toMatchObject({ status: "PENDING" });
      neverFinalized(rpc);
    }
  });

  it("unexpected error while sending => PENDING + flagged for review, no refund", async () => {
    const provider = fakeProvider({ createTransaction: vi.fn(async () => { throw new TypeError("boom"); }) });
    const { deps, rpc, store } = mk({ provider });
    expect(await performCheckout(deps, req)).toMatchObject({ ok: true, status: "PENDING", submission: "FLAGGED" });
    expect(store.flagReview).toHaveBeenCalledOnce();
    neverFinalized(rpc);
  });

  it("the API key can never be stored: redacted and truncated in the snapshot", async () => {
    const body = `echo ${SECRET} ` + "x".repeat(10000);
    const provider = fakeProvider({ createTransaction: vi.fn(async () => ({ kind: "response", raw: { httpStatus: 200, contentType: null, bodyText: body, json: undefined }, parsed: null }) as SubmitOutcome) });
    const { deps, store } = mk({ provider });
    await performCheckout(deps, req);
    const snap = JSON.stringify((store.saveProviderSnapshot as ReturnType<typeof vi.fn>).mock.calls[0]![1]);
    expect(snap).not.toContain(SECRET);
    expect(snap).toContain("***");
    expect(snap.length).toBeLessThan(5000);
  });
});

describe("performCheckout — idempotent repeats", () => {
  const existing = (over = {}) => fakeRpc({ reserve: vi.fn(async () => ({ outcome: "EXISTING", txId: "t", reffId: "TKAAAAAAAAAAAAAAAAAA", status: "PENDING", amount: 10000, balanceAfter: 1 })), ...over });
  const lost = (status: "PENDING" | "SUCCESS" | "FAILED") => vi.fn(async () => ({ claimed: false, txId: "t", reffId: "TKAAAAAAAAAAAAAAAAAA", status, attempts: 1 }));

  it("claim lost (an earlier request already sent it) => nothing is sent again", async () => {
    const rpc = existing({ claimSend: lost("PENDING") });
    const { deps, provider } = mk({ rpc });
    expect(await performCheckout(deps, req)).toMatchObject({ ok: true, created: false, status: "PENDING", submission: "ALREADY_HANDLED" });
    expect(provider.createTransaction).not.toHaveBeenCalled();
  });

  it("claim lost on an already final transaction => reports its real status, sends nothing", async () => {
    const rpc = existing({ claimSend: lost("SUCCESS") });
    const { deps, provider } = mk({ rpc });
    expect(await performCheckout(deps, req)).toMatchObject({ status: "SUCCESS", submission: "ALREADY_HANDLED" });
    expect(provider.createTransaction).not.toHaveBeenCalled();
  });

  it("reserved but never sent (crash) => the repeat wins the claim and sends, same reff_id", async () => {
    const { deps, provider } = mk({ rpc: existing() });
    expect(await performCheckout(deps, req)).toMatchObject({ created: false, submission: "SUBMITTED" });
    expect(provider.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ reffId: "TKAAAAAAAAAAAAAAAAAA" }));
  });

  it("two simultaneous recoveries with an atomic claim => the provider is called exactly once", async () => {
    let attempts = 0;
    // in-memory compare-and-set standing in for claim_provider_send (the real one is tested against Postgres)
    const claimSend = vi.fn(async () => {
      const won = attempts === 0; // check-and-set happens in ONE synchronous step, like the single UPDATE
      if (won) attempts = 1;
      await new Promise((r) => setTimeout(r, 1)); // latency AFTER the atomic step
      return { claimed: won, txId: tx().id, reffId: "TKAAAAAAAAAAAAAAAAAA", status: "PENDING" as const, attempts };
    });
    const provider = fakeProvider({ createTransaction: vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); return { kind: "transport_uncertain", reason: "timeout" } as SubmitOutcome; }) });
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => performCheckout({ ...mk({ rpc: existing({ claimSend }), provider }).deps }, req)));
    expect(provider.createTransaction).toHaveBeenCalledOnce();
    expect(results.filter((r) => r.ok && r.submission !== "ALREADY_HANDLED")).toHaveLength(1);
    expect(new Set(results.map((r) => (r.ok ? r.txId : "x"))).size).toBe(1);
  });
});

describe("performCheckout — rejections touch nothing", () => {
  const outcomes = ["MAINTENANCE", "INSUFFICIENT_BALANCE", "PRODUCT_UNAVAILABLE", "PRICE_CHANGED", "INVALID_DESTINATION", "USER_INACTIVE", "USER_NOT_FOUND"] as const;
  for (const o of outcomes) {
    it(`${o} => failure, provider never called`, async () => {
      const rpc = fakeRpc({ reserve: vi.fn(async () => ({ outcome: o, txId: null, reffId: null, status: null, amount: 12345, balanceAfter: 0 })) });
      const { deps, provider } = mk({ rpc });
      const r = await performCheckout(deps, req);
      expect(r).toMatchObject({ ok: false, code: o });
      if (o === "PRICE_CHANGED" && !r.ok) expect(r.currentPrice).toBe(12345);
      expect(provider.createTransaction).not.toHaveBeenCalled();
    });
  }

  it("every failure code has a user message and an HTTP status", () => {
    const codes: CheckoutFailureCode[] = [...outcomes, "PROVIDER_NOT_READY", "INVALID_INPUT"];
    for (const c of codes) {
      expect(checkoutErrorMessage(c).length).toBeGreaterThan(5);
      expect(checkoutHttpStatus(c)).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("checkoutInputSchema", () => {
  const ok = { productId: "11111111-1111-4111-8111-111111111111", destination: " 081234567890 ", idempotencyKey: "22222222-2222-4222-8222-222222222222" };
  it("accepts a clean request and trims the destination", () => {
    expect(checkoutInputSchema.parse(ok).destination).toBe("081234567890");
  });
  it("rejects bad ids, odd destinations and absurd prices", () => {
    expect(checkoutInputSchema.safeParse({ ...ok, productId: "nope" }).success).toBe(false);
    expect(checkoutInputSchema.safeParse({ ...ok, idempotencyKey: "short" }).success).toBe(false);
    for (const d of ["", "ab", "08 123", "0812&x=1", "a".repeat(65), "<script>"]) {
      expect(checkoutInputSchema.safeParse({ ...ok, destination: d }).success).toBe(false);
    }
    expect(checkoutInputSchema.safeParse({ ...ok, expectedPrice: -1 }).success).toBe(false);
    expect(checkoutInputSchema.safeParse({ ...ok, expectedPrice: 1.5 }).success).toBe(false);
  });
  it("has no field that could carry the price to charge", () => {
    const out = checkoutInputSchema.parse({ ...ok, price: 1, sell_price: 1, amount: 1 });
    expect(Object.keys(out).sort()).toEqual(["destination", "idempotencyKey", "productId"]);
  });
});
