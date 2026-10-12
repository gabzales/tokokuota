import { describe, expect, it } from "vitest";
import { createTransactionRpc, RpcError, type RpcCaller } from "@/lib/transactions/rpc";

const caller = (data: unknown, error: { message: string; code?: string } | null = null): RpcCaller & { last?: [string, unknown] } => {
  const c: RpcCaller & { last?: [string, unknown] } = {
    rpc: async (fn, args) => { c.last = [fn, args]; return { data, error }; },
  };
  return c;
};

describe("transaction RPC wrappers", () => {
  it("reserve sends NO price to charge: user, product, destination, idempotency key and an optional stale-price guard", async () => {
    const c = caller([{ out_outcome: "CREATED", out_tx_id: "t", out_reff_id: "TK1", out_status: "PENDING", out_amount: 10000, out_balance_after: 5 }]);
    const r = await createTransactionRpc(c).reserve({ userId: "u", productId: "p", destination: "0812345", idempotencyKey: "idem-key-1" });
    expect(Object.keys(c.last![1] as object).sort()).toEqual(["p_destination", "p_expected_price", "p_idempotency_key", "p_product_id", "p_user_id"]);
    expect(r).toMatchObject({ outcome: "CREATED", reffId: "TK1", amount: 10000, balanceAfter: 5 });
  });
  it("syncProducts maps the result row", async () => {
    const c = caller([{ out_inserted: 3, out_updated: 2 }]);
    expect(await createTransactionRpc(c).syncProducts({ provider: "khfypay", products: [], defaultMargin: 0, activateNew: false })).toEqual({ inserted: 3, updated: 2 });
    expect(c.last![0]).toBe("sync_products");
  });
  it("throws RpcError on database errors", async () => {
    await expect(createTransactionRpc(caller(null, { message: "boom", code: "42501" })).finalizeFailed({ reffId: "x" })).rejects.toBeInstanceOf(RpcError);
  });
  it("rejects responses that do not match the expected shape", async () => {
    await expect(createTransactionRpc(caller([{ out_outcome: "WHAT" }])).finalizeSuccess({ reffId: "x" })).rejects.toThrow(/unexpected response shape/);
  });
});
