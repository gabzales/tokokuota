import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTopupRpc, ingestIncomingTransfer } from "@/lib/topup/rpc";
import { pgRpc } from "./pg-adapters";

/** The TypeScript wrappers against the REAL top-up SQL (shapes, types, outcomes). Needs TEST_DATABASE_URL with 0001..0004 applied. */
const URL = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === "1" && !URL) throw new Error("REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is not set");

describe.skipIf(!URL)("top-up wrappers against real PostgreSQL", () => {
  let pool: pg.Pool;
  let rpc: ReturnType<typeof createTopupRpc>;
  let adminId: string;
  const stamp = Date.now();
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: URL, max: 20 });
    rpc = createTopupRpc(pgRpc(pool));
    const a = await pool.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [`tadm-${stamp}@t.test`]);
    adminId = a.rows[0]!.id;
    await pool.query(`update public.profiles set role = 'admin' where id = $1`, [adminId]);
    await pool.query(`select public.admin_update_settings($1, '{"topup_enabled":true,"topup_code_min":1,"topup_code_max":999,"topup_min_amount":10000,"topup_max_amount":2000000,"topup_expiry_minutes":1440}'::jsonb)`, [adminId]);
    await rpc.upsertBank({ adminId, code: "TST", bankName: "Bank Test", accountNumber: "1234567890", accountHolder: "Pemilik Test", isActive: true, sortOrder: 0 });
  });
  afterAll(async () => { await pool?.end(); });

  const user = async (tag: string) => (await pool.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [`tu-${tag}-${stamp}@t.test`])).rows[0]!.id;
  const saldo = async (id: string) => Number((await pool.query(`select saldo from public.profiles where id = $1`, [id])).rows[0].saldo);

  it("create -> exact-amount transfer -> credited once -> replay is a no-op -> request PAID", async () => {
    const u = await user("full");
    const created = await rpc.createRequest({ userId: u, bankCode: "TST", baseAmount: 50000, idempotencyKey: crypto.randomUUID() });
    expect(created.outcome).toBe("CREATED");
    expect(created.totalAmount).toBe(50000 + (created.uniqueCode as number));
    expect(created.uniqueCode).toBeGreaterThanOrEqual(1);
    expect(created.uniqueCode).toBeLessThanOrEqual(999);
    expect(typeof created.expiresAt).toBe("string");
    expect(await saldo(u)).toBe(0);

    const t = { bankCode: "tst", amount: created.totalAmount as number, bankRef: `MUT-${stamp}-1`, occurredAt: new Date().toISOString(), raw: { source: "test" } };
    const first = await ingestIncomingTransfer(rpc, t);
    expect(first).toMatchObject({ outcome: "CREDITED", requestId: created.requestId, userId: u });
    expect(await saldo(u)).toBe(created.totalAmount);

    expect((await ingestIncomingTransfer(rpc, t)).outcome).toBe("ALREADY_RECORDED");
    expect(await saldo(u)).toBe(created.totalAmount);
    const again = await rpc.createRequest({ userId: u, bankCode: "TST", baseAmount: 50000, idempotencyKey: crypto.randomUUID() });
    expect(again.outcome).toBe("CREATED");
  });

  it("a transfer nobody asked for is queued, not credited; an admin can then credit it exactly once", async () => {
    const u = await user("queue");
    const q = await ingestIncomingTransfer(rpc, { bankCode: "TST", amount: 77777, bankRef: `MUT-${stamp}-2` });
    expect(q.outcome).toBe("QUEUED");
    expect(await saldo(u)).toBe(0);
    const credit = await rpc.adminResolveTransfer({ adminId, transferId: q.transferId as string, action: "CREDIT", userId: u, note: "pemilik terverifikasi" });
    expect(credit).toEqual({ outcome: "CREDITED", balanceAfter: 77777 });
    expect((await rpc.adminResolveTransfer({ adminId, transferId: q.transferId as string, action: "CREDIT", userId: u, note: "sekali lagi" })).outcome).toBe("NOT_QUEUED");
    expect(await saldo(u)).toBe(77777);
  });

  it("rejections come back as outcomes (amount range, cap, unknown bank) and cancel frees the slot", async () => {
    const u = await user("rej");
    expect((await rpc.createRequest({ userId: u, bankCode: "TST", baseAmount: 5, idempotencyKey: crypto.randomUUID() })).outcome).toBe("AMOUNT_OUT_OF_RANGE");
    expect((await rpc.createRequest({ userId: u, bankCode: "NOPE", baseAmount: 50000, idempotencyKey: crypto.randomUUID() })).outcome).toBe("BANK_UNAVAILABLE");
    const made = [];
    for (let i = 0; i < 3; i++) made.push(await rpc.createRequest({ userId: u, bankCode: "TST", baseAmount: 20000, idempotencyKey: crypto.randomUUID() }));
    expect(made.every((m) => m.outcome === "CREATED")).toBe(true);
    expect((await rpc.createRequest({ userId: u, bankCode: "TST", baseAmount: 20000, idempotencyKey: crypto.randomUUID() })).outcome).toBe("TOO_MANY_PENDING");
    expect(await rpc.cancelRequest({ userId: u, requestId: made[0]!.requestId as string })).toBe("CANCELLED");
    expect((await rpc.createRequest({ userId: u, bankCode: "TST", baseAmount: 20000, idempotencyKey: crypto.randomUUID() })).outcome).toBe("CREATED");
  });

  it("admin confirm credits once; the sweeper returns a count", async () => {
    const u = await user("conf");
    const c = await rpc.createRequest({ userId: u, bankCode: "TST", baseAmount: 30000, idempotencyKey: crypto.randomUUID() });
    const first = await rpc.adminConfirmRequest({ adminId, requestId: c.requestId as string, note: "dicek di mutasi" });
    expect(first.outcome).toBe("APPLIED");
    expect((await rpc.adminConfirmRequest({ adminId, requestId: c.requestId as string, note: "dicek lagi" })).outcome).toBe("ALREADY_APPLIED");
    expect(await saldo(u)).toBe(c.totalAmount);
    expect(Number.isInteger(await rpc.expireStale())).toBe(true);
  });
});
