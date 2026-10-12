import type { ProviderAdapter } from "@/lib/providers/types";
import type { TransactionRpc } from "@/lib/transactions/rpc";
import { CatalogValidationError, normalizeProducts } from "./normalize";

export type SyncResult =
  | { status: "SYNCED"; inserted: number; updated: number }
  | { status: "SKIPPED_TRANSPORT"; reason: string }
  | { status: "SKIPPED_UNPARSED" }   // response schema not mapped / not recognised: nothing written
  | { status: "REJECTED_INVALID"; issue: string };

export async function syncCatalog(deps: {
  provider: ProviderAdapter;
  rpc: TransactionRpc;
  defaultMargin: number;
  activateNew: boolean;
}): Promise<SyncResult> {
  const res = await deps.provider.listProducts();
  if (res.kind === "transport_error") return { status: "SKIPPED_TRANSPORT", reason: res.reason };
  if (res.kind === "unparsed") return { status: "SKIPPED_UNPARSED" };

  try {
    const rows = normalizeProducts(res.data);
    const r = await deps.rpc.syncProducts({
      provider: deps.provider.id,
      products: rows,
      defaultMargin: deps.defaultMargin,
      activateNew: deps.activateNew,
    });
    return { status: "SYNCED", ...r };
  } catch (e) {
    if (e instanceof CatalogValidationError) return { status: "REJECTED_INVALID", issue: e.message };
    throw e;
  }
}
