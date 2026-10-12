import type { ProviderAdapter } from "@/lib/providers/types";
import type { TransactionRpc } from "./rpc";
import type { TransactionStore } from "./store";

export type ReconcileItemOutcome =
  | "TRANSPORT_ERROR"  // provider unreachable: try again later
  | "UNPARSED"         // answer received but schema unknown / unrecognised: fail closed
  | "NOT_LISTED"       // answer parsed but our refid is not in it: leave PENDING
  | "STILL_PENDING"    // provider says UNKNOWN status
  | "APPLIED" | "ALREADY_APPLIED" | "CONFLICT" | "NOT_FOUND";

export interface ReconcileSummary {
  enabled: boolean;
  checked: number;
  results: Record<string, number>;
}

export interface ReconcileDeps {
  provider: ProviderAdapter;
  store: TransactionStore;
  rpc: TransactionRpc;
  /** Master switch (POLICY.RECONCILE_ENABLED). When false, nothing is called or changed. */
  enabled: boolean;
  olderThanMs?: number;
  notReconciledWithinMs?: number;
  limit?: number;
}

/**
 * Looks up PENDING transactions on the provider by `refid` and finalizes ONLY when the answer was
 * parsed into the normalized type and gives a definite SUCCESS/FAILED for exactly our reff_id.
 * Transport errors, unparsed answers and unknown statuses never change a transaction.
 * Disabled until the real /history schema exists (Tahap 2B).
 */
export async function reconcilePending(deps: ReconcileDeps): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { enabled: deps.enabled, checked: 0, results: {} };
  if (!deps.enabled) return summary;

  const pending = await deps.store.listPendingForReconcile({
    olderThanMs: deps.olderThanMs ?? 2 * 60_000,
    notReconciledWithinMs: deps.notReconciledWithinMs ?? 5 * 60_000,
    limit: Math.min(deps.limit ?? 20, 50),
  });

  const bump = (k: ReconcileItemOutcome) => { summary.results[k] = (summary.results[k] ?? 0) + 1; };

  for (const tx of pending) {
    summary.checked++;
    const res = await deps.provider.getHistory({ reffId: tx.reffId });
    await deps.store.touchReconciled(tx.reffId);

    if (res.kind === "transport_error") { bump("TRANSPORT_ERROR"); continue; }
    if (res.kind === "unparsed") { bump("UNPARSED"); continue; }

    const entry = res.data.find((e) => e.reffId === tx.reffId);
    if (!entry) { bump("NOT_LISTED"); continue; }
    if (entry.status === "UNKNOWN") { bump("STILL_PENDING"); continue; }

    const args = { reffId: tx.reffId, message: entry.message, raw: entry.raw };
    const r = entry.status === "SUCCESS" ? await deps.rpc.finalizeSuccess(args) : await deps.rpc.finalizeFailed(args);
    bump(r.outcome);
  }
  return summary;
}
