import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { performCheckout, sendIfClaimed, type CheckoutDeps } from "@/lib/transactions/checkout";
import { createTransactionRpc } from "@/lib/transactions/rpc";
import type { ProviderAdapter, SubmitOutcome } from "@/lib/providers/types";
import { pgRpc, pgStore } from "./pg-adapters";

/**
 * RECOVERY-SEND CONCURRENCY — runs against a REAL PostgreSQL with 0001..0003 applied.
 *
 *   TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/scratch npm run test:db
 *
 * Scenario: a transaction has reserved the balance but was never sent (provider_attempts = 0).
 * Several recovery requests arrive at the same moment and all try to send /trx.
 * Only ONE may win the database claim and call the provider; all others must not, and every
 * request must refer to the same transaction / reff_id.
 */
const URL = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_DB_TESTS === "1" && !URL) throw new Error("REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is not set");

describe.skipIf(!URL)("recovery-send concurrency (real PostgreSQL)", () => {
  let pool: pg.Pool;
  const SECRET = "KEY-SECRET-123456";

  beforeAll(() => { pool = new pg.Pool({ connectionString: URL, max: 40 }); });
  afterAll(async () => { await pool?.end(); });

  /** A provider double that is SLOW, so a second sender would certainly overlap the first. */
  function slowProvider(delayMs = 150) {
    const createTransaction = vi.fn(async (): Promise<SubmitOutcome> => {
      await new Promise((r) => setTimeout(r, delayMs));
      return { kind: "response", raw: { httpStatus: 200, contentType: "text/plain", bodyText: "unknown shape", json: undefined }, parsed: null };
    });
    const provider = {
      id: "khfypay", assertReady: vi.fn(), createTransaction,
      listProducts: vi.fn(), getHistory: vi.fn(), checkAkrabStock: vi.fn(),
    } as unknown as ProviderAdapter & { createTransaction: typeof createTransaction };
    return provider;
  }

  const deps = (provider: ProviderAdapter): CheckoutDeps => ({
    rpc: createTransactionRpc(pgRpc(pool)), store: pgStore(pool), provider, secrets: [SECRET],
  });

  /** Fixture: user with balance + a product + a transaction that is RESERVED but NOT sent. */
  async function reservedUnsent(tag: string) {
    const u = await pool.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [`rec-${tag}-${Date.now()}@t.test`]);
    const userId = u.rows[0]!.id;
    const a = await pool.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [`recadm-${tag}-${Date.now()}@t.test`]);
    await pool.query(`update public.profiles set role = 'admin' where id = $1`, [a.rows[0]!.id]);
    await pool.query(`select public.admin_manual_topup($1, $2, 100000, $3, 'seed')`, [a.rows[0]!.id, userId, `seed-${tag}-${Date.now()}-xx`]);
    const p = await pool.query<{ id: string }>(
      `insert into public.products_cache (provider_code, name, cost_price, margin) values ($1, 'Rec', 9000, 1000) returning id`, [`REC-${tag}-${Date.now()}`]);
    const productId = p.rows[0]!.id;
    const idem = crypto.randomUUID();
    const r = await pool.query(`select * from public.reserve_balance_and_create_transaction($1, $2, '081234567890', $3)`, [userId, productId, idem]);
    expect(r.rows[0].out_outcome).toBe("CREATED");
    const tx = await pool.query(`select provider_attempts from public.transactions where reff_id = $1`, [r.rows[0].out_reff_id]);
    expect(tx.rows[0].provider_attempts).toBe(0); // precondition: reserved, never sent
    return { userId, productId, idem, reffId: r.rows[0].out_reff_id as string, txId: r.rows[0].out_tx_id as string };
  }

  const state = async (reffId: string, userId: string) => {
    const t = await pool.query(`select status, provider_attempts, provider_raw from public.transactions where reff_id = $1`, [reffId]);
    const l = await pool.query(`select type, count(*)::int as n from public.balance_ledger where user_id = $1 group by type`, [userId]);
    const s = await pool.query(`select saldo from public.profiles where id = $1`, [userId]);
    return { tx: t.rows[0], ledger: Object.fromEntries(l.rows.map((x) => [x.type, x.n])), saldo: Number(s.rows[0].saldo) };
  };

  it("two simultaneous recovery requests (same idempotency key): exactly one sends /trx", async () => {
    const f = await reservedUnsent("two");
    const provider = slowProvider();
    const req = { userId: f.userId, productId: f.productId, destination: "081234567890", idempotencyKey: f.idem };

    const [a, b] = await Promise.all([performCheckout(deps(provider), req), performCheckout(deps(provider), req)]);

    expect(provider.createTransaction).toHaveBeenCalledTimes(1);
    expect(provider.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ reffId: f.reffId }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect([a.submission, b.submission].sort()).toEqual(["ALREADY_HANDLED", "SUBMITTED"]);
    expect(a.txId).toBe(f.txId);
    expect(b.txId).toBe(f.txId); // both refer to the same transaction
    const s = await state(f.reffId, f.userId);
    expect(s.tx.provider_attempts).toBe(1);
    expect(s.tx.status).toBe("PENDING");
    expect(s.ledger).toMatchObject({ PURCHASE: 1 });
    expect(s.ledger.REFUND).toBeUndefined(); // never refunded
    expect(s.saldo).toBe(100000 - 10000); // debited once
  });

  it("checkout recovery racing an admin 'send to provider': still exactly one /trx", async () => {
    const f = await reservedUnsent("mixed");
    const provider = slowProvider();
    const req = { userId: f.userId, productId: f.productId, destination: "081234567890", idempotencyKey: f.idem };

    const results = await Promise.all([
      performCheckout(deps(provider), req),
      sendIfClaimed(deps(provider), f.reffId),
      performCheckout(deps(provider), req),
      sendIfClaimed(deps(provider), f.reffId),
    ]);

    expect(provider.createTransaction).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.txId).toBe(f.txId);
    }
    expect(results.filter((r) => r.ok && r.submission !== "ALREADY_HANDLED")).toHaveLength(1);
    expect((await state(f.reffId, f.userId)).tx.provider_attempts).toBe(1);
  });

  it("20 simultaneous recoveries: one claim, one /trx, 19 stand down", async () => {
    const f = await reservedUnsent("many");
    const provider = slowProvider(300);
    const results = await Promise.all(Array.from({ length: 20 }, () => sendIfClaimed(deps(provider), f.reffId)));

    expect(provider.createTransaction).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.ok && r.submission === "ALREADY_HANDLED")).toHaveLength(19);
    expect(new Set(results.map((r) => (r.ok ? r.txId : "x"))).size).toBe(1);
    expect((await state(f.reffId, f.userId)).tx.provider_attempts).toBe(1);
  });

  it("the loser never sends even when the winner is still in flight; the raw answer is stored without the API key", async () => {
    const f = await reservedUnsent("late");
    const provider = slowProvider(400);
    const winner = sendIfClaimed(deps(provider), f.reffId);
    await new Promise((r) => setTimeout(r, 50)); // winner has claimed and is waiting on the provider
    const late = await sendIfClaimed(deps(provider), f.reffId);
    expect(late).toMatchObject({ ok: true, submission: "ALREADY_HANDLED", txId: f.txId });
    expect(provider.createTransaction).toHaveBeenCalledTimes(1);
    await winner;
    const s = await state(f.reffId, f.userId);
    expect(s.tx.provider_raw.kind).toBe("response");
    expect(JSON.stringify(s.tx.provider_raw)).not.toContain(SECRET);
  });

  it("a timeout on the winner leaves the transaction PENDING and nobody re-sends or refunds", async () => {
    const f = await reservedUnsent("timeout");
    const provider = slowProvider(10);
    provider.createTransaction.mockImplementation(async () => ({ kind: "transport_uncertain", reason: "timeout" }) as SubmitOutcome);
    const first = await sendIfClaimed(deps(provider), f.reffId);
    const second = await sendIfClaimed(deps(provider), f.reffId);
    expect(first).toMatchObject({ ok: true, submission: "UNCERTAIN", status: "PENDING" });
    expect(second).toMatchObject({ ok: true, submission: "ALREADY_HANDLED" });
    expect(provider.createTransaction).toHaveBeenCalledTimes(1);
    const s = await state(f.reffId, f.userId);
    expect(s.tx.status).toBe("PENDING");
    expect(s.ledger.REFUND).toBeUndefined();
    expect(s.saldo).toBe(90000);
  });
});
