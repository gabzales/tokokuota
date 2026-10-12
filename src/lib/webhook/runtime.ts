import "server-only";
import { notify } from "@/lib/alerts/server";
import { webhookSecret } from "@/lib/env/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTransactionRpc, type RpcCaller } from "@/lib/transactions/rpc";
import { createSupabaseTransactionStore } from "@/lib/transactions/store";
import { processWebhook } from "@/lib/transactions/webhook-processor";
import { handleWebhookRequest } from "./handler";

const ANOMALIES = new Set(["CONFLICT", "NOT_FOUND", "REJECTED_NOT_SUBMITTED", "REJECTED_MISMATCH", "NOT_VERIFIED"]);

/** Wires the webhook handler to the real database. Shared by every webhook URL shape. */
export function handleWebhook(req: Request, pathToken?: string): Promise<Response> {
  return handleWebhookRequest(
    req,
    {
      getSecret: webhookSecret,
      process: async (input) => {
        const db = createAdminClient();
        const outcome = await processWebhook(
          { provider: "khfypay", rpc: createTransactionRpc(db as unknown as RpcCaller), store: createSupabaseTransactionStore(db) },
          input,
        );
        // UNPARSED / NO_STATUS are expected until the real message format is mapped (they show up in the daily digest).
        if (ANOMALIES.has(outcome)) notify({ severity: "critical", title: "Webhook tidak biasa", lines: [`hasil: ${outcome}`, "Cek Admin > Monitoring."] });
        return outcome;
      },
    },
    pathToken,
  );
}
