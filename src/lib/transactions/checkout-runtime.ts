import "server-only";
import { notify } from "@/lib/alerts/server";
import { providerEnv } from "@/lib/env/server";
import { getProvider } from "@/lib/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { performCheckout, sendIfClaimed, type CheckoutRequest, type CheckoutResult, type SendResult } from "./checkout";
import { createTransactionRpc, type RpcCaller } from "./rpc";
import { createSupabaseTransactionStore } from "./store";

/** Wires performCheckout to the real database and provider. Server only. */
export async function runCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
  const db: SupabaseClient = createAdminClient();
  const result = await performCheckout(
    {
      rpc: createTransactionRpc(db as unknown as RpcCaller),
      store: createSupabaseTransactionStore(db),
      provider: getProvider(),
      secrets: [providerEnv().KHFYPAY_API_KEY],
    },
    req,
  );
  if (result.ok && result.submission === "FLAGGED") {
    notify({ severity: "critical", title: "Transaksi ditandai review", lines: [`tx ${result.txId}`, "Error tak terduga saat mengirim ke provider. Status tetap PENDING, tidak ada refund otomatis."] });
  }
  return result;
}

/** Atomic-claim send for an existing transaction (admin "send to provider" / recovery). Server only. */
export async function runSend(reffId: string): Promise<SendResult> {
  const db: SupabaseClient = createAdminClient();
  const result = await sendIfClaimed(
    {
      rpc: createTransactionRpc(db as unknown as RpcCaller),
      store: createSupabaseTransactionStore(db),
      provider: getProvider(),
      secrets: [providerEnv().KHFYPAY_API_KEY],
    },
    reffId,
  );
  if (result.ok && result.submission === "FLAGGED") {
    notify({ severity: "critical", title: "Transaksi ditandai review", lines: [`tx ${result.txId}`, "Error tak terduga saat mengirim ke provider."] });
  }
  return result;
}
