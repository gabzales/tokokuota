import { describe, expect, it, vi } from "vitest";
import { toTopupSettings } from "@/lib/settings/keys";
import { createTopupMessage, TRANSFER_REASONS } from "@/lib/topup/messages";
import { createTopupRpc, ingestIncomingTransfer } from "@/lib/topup/rpc";
import { bankSchema, cancelTopupSchema, confirmTopupSchema, createTopupSchema, resolveTransferSchema } from "@/lib/topup/schemas";
import { parseTopupFilters } from "@/lib/admin/list-params";
import { RpcError, type RpcCaller } from "@/lib/transactions/rpc";

const U = "11111111-1111-4111-8111-111111111111";
const caller = (data: unknown, error: { message: string; code?: string } | null = null) => {
  const c: RpcCaller & { calls: [string, Record<string, unknown>][] } = {
    calls: [], rpc: async (fn, args) => { c.calls.push([fn, args ?? {}]); return { data, error }; },
  };
  return c;
};

describe("create-top-up form schema", () => {
  const ok = { bank: " bri ", amount: "50000", idempotencyKey: U };
  it("normalises bank, coerces amount", () => {
    expect(createTopupSchema.parse(ok)).toEqual({ bank: "BRI", amount: 50000, idempotencyKey: U });
  });
  it("an empty amount is an error, never 0; fractions, negatives and junk are rejected", () => {
    for (const amount of ["", "   ", "0", "-5", "1.5", "abc", "2000000000"]) expect(createTopupSchema.safeParse({ ...ok, amount }).success).toBe(false);
    expect(createTopupSchema.safeParse({ ...ok, bank: "b r i" }).success).toBe(false);
    expect(createTopupSchema.safeParse({ ...ok, idempotencyKey: "short" }).success).toBe(false);
  });
  it("cannot carry a user id, a unique code or a total: those are never client input", () => {
    const out = createTopupSchema.parse({ ...ok, userId: "x", unique_code: 1, total_amount: 1 });
    expect(Object.keys(out).sort()).toEqual(["amount", "bank", "idempotencyKey"]);
  });
});

describe("admin top-up schemas", () => {
  it("confirm / resolve require a note; CREDIT requires an e-mail", () => {
    expect(confirmTopupSchema.safeParse({ requestId: U, note: "ok" }).success).toBe(false);
    expect(confirmTopupSchema.safeParse({ requestId: U, note: "dicek di mutasi" }).success).toBe(true);
    expect(resolveTransferSchema.safeParse({ transferId: U, action: "CREDIT", note: "terverifikasi" }).success).toBe(false);
    expect(resolveTransferSchema.safeParse({ transferId: U, action: "CREDIT", userEmail: " A@B.com ", note: "terverifikasi" })).toMatchObject({ success: true, data: { userEmail: "a@b.com" } });
    expect(resolveTransferSchema.safeParse({ transferId: U, action: "IGNORE", note: "salah kirim" }).success).toBe(true);
    expect(resolveTransferSchema.safeParse({ transferId: U, action: "DELETE", note: "salah kirim" }).success).toBe(false);
    expect(cancelTopupSchema.safeParse({ requestId: "nope" }).success).toBe(false);
  });
  it("bank form: digits-only account number, code pattern, empty order is an error", () => {
    const ok = { code: "bri", bank_name: "Bank BRI", account_number: "1234567890", account_holder: "Nama Pemilik", is_active: "true", sort_order: "0" };
    expect(bankSchema.parse(ok)).toMatchObject({ code: "BRI", is_active: true, sort_order: 0 });
    for (const bad of [{ account_number: "12ab" }, { account_number: "123" }, { code: "B" }, { code: "bri!" }, { bank_name: "" }, { sort_order: "" }, { is_active: "maybe" }]) {
      expect(bankSchema.safeParse({ ...ok, ...bad }).success).toBe(false);
    }
  });
});

describe("top-up RPC wrappers", () => {
  const row = { out_outcome: "CREATED", out_request_id: U, out_bank_code: "BRI", out_base_amount: 50000, out_unique_code: 398, out_total_amount: 50398, out_expires_at: "2026-10-06T10:00:00Z", out_status: "PENDING" };
  it("createRequest sends only user, bank, base amount and key: no code, no total", async () => {
    const c = caller([row]);
    const r = await createTopupRpc(c).createRequest({ userId: "u", bankCode: "BRI", baseAmount: 50000, idempotencyKey: "key-12345" });
    expect(Object.keys(c.calls[0]![1]).sort()).toEqual(["p_bank_code", "p_base_amount", "p_idempotency_key", "p_user_id"]);
    expect(r).toMatchObject({ outcome: "CREATED", totalAmount: 50398, uniqueCode: 398, expiresAt: "2026-10-06T10:00:00.000Z" });
  });
  it("accepts Date objects and null rows for rejections", async () => {
    const r = await createTopupRpc(caller([{ ...row, out_outcome: "AMOUNT_OUT_OF_RANGE", out_request_id: null, out_bank_code: null, out_base_amount: null, out_unique_code: null, out_total_amount: null, out_expires_at: null, out_status: null }])).createRequest({ userId: "u", bankCode: "BRI", baseAmount: 1, idempotencyKey: "key-12345" });
    expect(r.outcome).toBe("AMOUNT_OUT_OF_RANGE");
    expect((await createTopupRpc(caller([{ ...row, out_expires_at: new Date("2026-10-06T10:00:00Z") }])).createRequest({ userId: "u", bankCode: "BRI", baseAmount: 1, idempotencyKey: "key-12345" })).expiresAt).toBe("2026-10-06T10:00:00.000Z");
  });
  it("unknown outcomes / shapes fail loudly instead of being trusted", async () => {
    await expect(createTopupRpc(caller([{ ...row, out_outcome: "WEIRD" }])).createRequest({ userId: "u", bankCode: "BRI", baseAmount: 1, idempotencyKey: "key-12345" })).rejects.toThrow(/unexpected response shape/);
    await expect(createTopupRpc(caller(null, { message: "x", code: "42501" })).cancelRequest({ userId: "u", requestId: U })).rejects.toBeInstanceOf(RpcError);
  });
  it("record_incoming_transfer is called with the provider-neutral fields only", async () => {
    const c = caller([{ out_outcome: "CREDITED", out_transfer_id: U, out_request_id: U, out_user_id: U }]);
    const r = await createTopupRpc(c).recordIncomingTransfer({ bankCode: "BRI", amount: 52398, bankRef: "MUT-1", occurredAt: "2026-10-06T09:00:00Z", raw: { a: 1 } });
    expect(r.outcome).toBe("CREDITED");
    expect(c.calls[0]![0]).toBe("record_incoming_transfer");
    expect(Object.keys(c.calls[0]![1]).sort()).toEqual(["p_amount", "p_bank_code", "p_bank_ref", "p_occurred_at", "p_raw"]);
  });
  it("expireStale reads a scalar or a one-column row", async () => {
    expect(await createTopupRpc(caller(3)).expireStale()).toBe(3);
    expect(await createTopupRpc(caller([{ expire_topup_requests: 2 }])).expireStale()).toBe(2);
  });
});

describe("ingestIncomingTransfer (the single door for the future webhook)", () => {
  const rpc = () => ({ recordIncomingTransfer: vi.fn(async () => ({ outcome: "CREDITED" as const, transferId: null, requestId: null, userId: null })) });
  it("normalises and forwards", async () => {
    const r = rpc();
    await ingestIncomingTransfer(r, { bankCode: "bri", amount: 52398, bankRef: "  MUT-9 " });
    expect(r.recordIncomingTransfer).toHaveBeenCalledWith(expect.objectContaining({ bankCode: "BRI", bankRef: "MUT-9", amount: 52398 }));
  });
  it("refuses fractional / non-positive amounts and blank references before touching the database", async () => {
    const r = rpc();
    for (const amount of [0, -1, 10.5, NaN]) await expect(ingestIncomingTransfer(r, { bankCode: "BRI", amount, bankRef: "x" })).rejects.toThrow();
    await expect(ingestIncomingTransfer(r, { bankCode: "BRI", amount: 1000, bankRef: "   " })).rejects.toThrow();
    expect(r.recordIncomingTransfer).not.toHaveBeenCalled();
  });
});

describe("messages, settings, filters", () => {
  it("every rejection outcome has a user message; the range message shows the limits", () => {
    for (const o of ["TOPUP_DISABLED", "USER_NOT_FOUND", "USER_INACTIVE", "BANK_UNAVAILABLE", "AMOUNT_OUT_OF_RANGE", "TOO_MANY_PENDING", "NO_CODE_AVAILABLE"] as const) {
      expect(createTopupMessage(o, { min: 10000, max: 2000000 }).length).toBeGreaterThan(8);
    }
    expect(createTopupMessage("AMOUNT_OUT_OF_RANGE", { min: 10000, max: 2000000 })).toMatch(/10\.000.*2\.000\.000/);
    for (const reason of ["NO_MATCH", "EXPIRED", "USER_INACTIVE", "MATCHES_PAID_REQUEST"]) expect(TRANSFER_REASONS[reason]).toBeTruthy();
  });
  it("settings mapping: defaults when missing, off unless explicitly true", () => {
    expect(toTopupSettings([])).toEqual({ enabled: false, min: 10000, max: 2000000, codeMin: 1, codeMax: 999, expiryMinutes: 1440 });
    expect(toTopupSettings([{ key: "topup_enabled", value: "true" }]).enabled).toBe(false);
    expect(toTopupSettings([{ key: "topup_enabled", value: true }, { key: "topup_min_amount", value: 20000 }, { key: "topup_expiry_minutes", value: 60 }])).toMatchObject({ enabled: true, min: 20000, expiryMinutes: 60 });
  });
  it("top-up admin filters fall back safely", () => {
    expect(parseTopupFilters({ view: "x", status: "HACK", page: "-1" })).toEqual({ view: "requests", status: undefined, q: undefined, page: 1 });
    expect(parseTopupFilters({ view: "queue", status: "QUEUED" })).toMatchObject({ view: "queue", status: "QUEUED" });
  });
});
