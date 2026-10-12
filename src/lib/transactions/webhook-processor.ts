import type { ParsedWebhook, WebhookInput } from "@/lib/providers/khfypay/webhook";
import {
  extractMessage,
  mentionsDestination,
  parseWebhookMessage,
  webhookDedupeKey,
} from "@/lib/providers/khfypay/webhook";
import type { TransactionRpc } from "./rpc";
import type { TransactionStore, TxRecord } from "./store";

export type WebhookOutcome =
  | "UNPARSED"                // no (single) reff_id of ours in the message: logged only
  | "NO_STATUS"               // reff_id found but success/failure not determinable: logged only
  | "NOT_FOUND"               // no such local transaction
  | "REJECTED_NOT_SUBMITTED"  // callback for a transaction we never sent to the provider
  | "REJECTED_MISMATCH"       // required corroboration (destination) missing
  | "NOT_VERIFIED"            // optional /history verification did not confirm
  | "APPLIED"
  | "ALREADY_APPLIED"         // duplicate callback: no second effect
  | "CONFLICT";               // contradicts a final state: flagged, money untouched

export type VerifyVerdict = "CONFIRMED" | "CONTRADICTED" | "INCONCLUSIVE";

export interface WebhookDeps {
  provider: string;
  rpc: TransactionRpc;
  store: TransactionStore;
  parse?: (message: string) => ParsedWebhook | null;
  /**
   * Independent confirmation (e.g. /history lookup by refid). Not wired yet: the /history
   * response schema is unknown. When provided, finalization requires CONFIRMED.
   */
  verify?: (tx: TxRecord, claimed: "SUCCESS" | "FAILED") => Promise<VerifyVerdict>;
  /** Require the message to mention the destination. Off by default: message layout unknown. */
  requireDestinationInMessage?: boolean;
}

/**
 * Transport-agnostic webhook handling (authentication happens before this, in the handler).
 *
 * Validation chain before any state change:
 *   message → our reff_id → local transaction exists → it was actually sent to the provider
 *   → (optional) destination corroboration → (optional) independent verification
 *   → finalize_* RPC, which is the idempotent, row-locked state machine.
 *
 * Idempotency is NOT decided here: duplicates, replays and concurrent callbacks all end in
 * ALREADY_APPLIED / CONFLICT inside the database.
 */
export async function processWebhook(deps: WebhookDeps, input: WebhookInput): Promise<WebhookOutcome> {
  const parse = deps.parse ?? parseWebhookMessage;
  const message = extractMessage(input);
  const parsed = message === null ? null : parse(message);

  const event = await deps.rpc.logWebhookEvent({
    provider: deps.provider,
    dedupeKey: webhookDedupeKey(input),
    reffId: parsed?.reffId ?? null,
    payload: {
      method: input.method,
      query: Object.fromEntries(input.query.entries()),
      contentType: input.contentType,
      body: input.bodyText,
    },
  });

  const outcome = await decide(deps, parsed, message);
  await deps.rpc.setWebhookOutcome({ eventId: event.eventId, outcome });
  return outcome;
}

async function decide(deps: WebhookDeps, parsed: ParsedWebhook | null, message: string | null): Promise<WebhookOutcome> {
  if (!parsed || message === null) return "UNPARSED";
  if (parsed.status === "UNKNOWN") return "NO_STATUS";

  const tx = await deps.store.getByReffId(parsed.reffId);
  if (!tx) return "NOT_FOUND";

  if (tx.status === "PENDING") {
    if (tx.providerAttempts === 0) return "REJECTED_NOT_SUBMITTED";
    if (deps.requireDestinationInMessage && !mentionsDestination(message, tx.destination)) {
      return "REJECTED_MISMATCH";
    }
    if (deps.verify) {
      const verdict = await deps.verify(tx, parsed.status);
      if (verdict === "CONTRADICTED") {
        await deps.store.flagReview(tx.reffId, `Webhook claimed ${parsed.status} but verification contradicted it`);
        return "NOT_VERIFIED";
      }
      if (verdict !== "CONFIRMED") return "NOT_VERIFIED";
    }
  }

  const args = { reffId: tx.reffId, message: parsed.message, raw: { message } };
  const r = parsed.status === "SUCCESS" ? await deps.rpc.finalizeSuccess(args) : await deps.rpc.finalizeFailed(args);
  return r.outcome;
}
