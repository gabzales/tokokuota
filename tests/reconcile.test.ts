import { describe, expect, it, vi } from "vitest";
import { reconcilePending } from "@/lib/transactions/reconcile";
import type { ProviderCall, ProviderHistoryEntry } from "@/lib/providers/types";
import { fakeProvider, fakeRpc, fakeStore, tx } from "./helpers";

const raw = { httpStatus: 200, contentType: null, bodyText: "", json: undefined };
const history = (res: ProviderCall<ProviderHistoryEntry[]>) => fakeProvider({ getHistory: vi.fn(async () => res) });
const entry = (status: ProviderHistoryEntry["status"], reffId = "TKAAAAAAAAAAAAAAAAAA"): ProviderHistoryEntry => ({ reffId, status, message: "m", raw: {} });
const run = (provider: ReturnType<typeof fakeProvider>, enabled = true) => {
  const rpc = fakeRpc(); const store = fakeStore(tx({ providerAttempts: 1 }));
  return { rpc, store, provider, promise: reconcilePending({ provider, rpc, store, enabled }) };
};

describe("reconcilePending", () => {
  it("DISABLED (the 2B hold): calls nothing, changes nothing", async () => {
    const r = run(history({ kind: "ok", data: [entry("FAILED")], raw }), false);
    expect(await r.promise).toEqual({ enabled: false, checked: 0, results: {} });
    expect(r.store.listPendingForReconcile).not.toHaveBeenCalled();
    expect(r.provider.getHistory).not.toHaveBeenCalled();
  });

  it("fail closed: transport errors and unparsed answers never change a transaction", async () => {
    for (const [res, key] of [[{ kind: "transport_error", reason: "timeout" }, "TRANSPORT_ERROR"], [{ kind: "unparsed", raw }, "UNPARSED"]] as const) {
      const r = run(history(res));
      expect((await r.promise).results).toEqual({ [key]: 1 });
      expect(r.rpc.finalizeSuccess).not.toHaveBeenCalled();
      expect(r.rpc.finalizeFailed).not.toHaveBeenCalled();
    }
  });

  it("looks up by OUR reff_id; another id, or UNKNOWN status, changes nothing", async () => {
    const other = run(history({ kind: "ok", data: [entry("FAILED", "TKBBBBBBBBBBBBBBBBBB")], raw }));
    expect((await other.promise).results).toEqual({ NOT_LISTED: 1 });
    const unknown = run(history({ kind: "ok", data: [entry("UNKNOWN")], raw }));
    expect((await unknown.promise).results).toEqual({ STILL_PENDING: 1 });
    for (const r of [other, unknown]) { expect(r.rpc.finalizeFailed).not.toHaveBeenCalled(); expect(r.rpc.finalizeSuccess).not.toHaveBeenCalled(); }
    expect(unknown.provider.getHistory).toHaveBeenCalledWith({ reffId: "TKAAAAAAAAAAAAAAAAAA" });
  });

  it("only a definite, parsed SUCCESS/FAILED for our id finalizes", async () => {
    const s = run(history({ kind: "ok", data: [entry("SUCCESS")], raw }));
    expect((await s.promise).results).toEqual({ APPLIED: 1 });
    expect(s.rpc.finalizeSuccess).toHaveBeenCalledOnce();
    const f = run(history({ kind: "ok", data: [entry("FAILED")], raw }));
    await f.promise;
    expect(f.rpc.finalizeFailed).toHaveBeenCalledOnce();
    expect(f.store.touchReconciled).toHaveBeenCalledOnce();
  });
});
