import { z } from "zod";
import type { FinalizeOutcome, ReserveOutcome, TopupOutcome, TransactionStatus } from "./types";

/** Minimal slice of the Supabase client we need (the service-role client satisfies it). */
export interface RpcCaller {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
}

export class RpcError extends Error {
  constructor(fn: string, public readonly code: string | undefined, message: string) {
    super(`${fn} failed: ${message}`);
    this.name = "RpcError";
  }
}

export interface SyncProductRow {
  provider_code: string;
  name: string;
  category: string | null;
  cost_price: number;
  is_available: boolean;
  raw: unknown;
}

export interface ReserveResult {
  outcome: ReserveOutcome;
  txId: string | null;
  reffId: string | null;
  status: TransactionStatus | null;
  amount: number | null;
  balanceAfter: number | null;
}
export interface FinalizeResult {
  outcome: FinalizeOutcome;
  txId: string | null;
  status: TransactionStatus | null;
}
export interface ClaimResult {
  claimed: boolean;
  txId: string | null;
  reffId: string | null;
  status: TransactionStatus | null;
  attempts: number | null;
}
export interface TopupResult {
  outcome: TopupOutcome;
  ledgerId: number | null;
  balanceAfter: number | null;
}

export interface TransactionRpc {
  /** expectedPrice is only a guard against a stale catalogue; the charged price always comes from the DB. */
  reserve(a: { userId: string; productId: string; destination: string; idempotencyKey: string; expectedPrice?: number | null }): Promise<ReserveResult>;
  syncProducts(a: { provider: string; products: SyncProductRow[]; defaultMargin: number; activateNew: boolean }): Promise<{ inserted: number; updated: number }>;
  finalizeSuccess(a: { reffId: string; message?: string | null; raw?: unknown }): Promise<FinalizeResult>;
  finalizeFailed(a: { reffId: string; message?: string | null; raw?: unknown }): Promise<FinalizeResult>;
  /**
   * Atomic compare-and-set (provider_attempts 0 -> 1). Only the caller that gets `claimed: true`
   * may send /trx for this transaction; every other caller must not.
   */
  claimSend(a: { reffId: string }): Promise<ClaimResult>;
  manualTopup(a: { adminId: string; userId: string; amount: number; idempotencyKey: string; note?: string | null }): Promise<TopupResult>;
  logWebhookEvent(a: { provider: string; dedupeKey: string; reffId: string | null; payload: unknown }): Promise<{ eventId: number; receiveCount: number }>;
  setWebhookOutcome(a: { eventId: number; outcome: string }): Promise<void>;
}

// bigint columns arrive as JSON numbers from PostgREST; rupiah stay far below 2^53.
const num = z.number().int();
const status = z.enum(["PENDING", "SUCCESS", "FAILED"]);

const reserveRow = z.object({
  out_outcome: z.enum([
    "CREATED", "EXISTING", "USER_NOT_FOUND", "USER_INACTIVE", "MAINTENANCE",
    "INVALID_DESTINATION", "PRODUCT_UNAVAILABLE", "PRICE_CHANGED", "INSUFFICIENT_BALANCE",
  ]),
  out_tx_id: z.string().nullable(),
  out_reff_id: z.string().nullable(),
  out_status: status.nullable(),
  out_amount: num.nullable(),
  out_balance_after: num.nullable(),
});
const finalizeRow = z.object({
  out_outcome: z.enum(["APPLIED", "ALREADY_APPLIED", "CONFLICT", "NOT_FOUND"]),
  out_tx_id: z.string().nullable(),
  out_status: status.nullable(),
});
const topupRow = z.object({
  out_outcome: z.enum(["APPLIED", "ALREADY_APPLIED", "USER_NOT_FOUND"]),
  out_ledger_id: num.nullable(),
  out_balance_after: num.nullable(),
});
const claimRow = z.object({
  out_claimed: z.boolean(),
  out_tx_id: z.string().nullable(),
  out_reff_id: z.string().nullable(),
  out_status: status.nullable(),
  out_attempts: num.nullable(),
});
const syncRow = z.object({ out_inserted: num, out_updated: num });
const eventRow = z.object({ out_event_id: num, out_receive_count: num });

function firstRow<T extends z.ZodTypeAny>(fn: string, schema: T, data: unknown): z.infer<T> {
  const rows = Array.isArray(data) ? data : [data];
  const parsed = schema.safeParse(rows[0]);
  if (!parsed.success) throw new RpcError(fn, undefined, `unexpected response shape (${parsed.error.issues[0]?.message})`);
  return parsed.data;
}

export function createTransactionRpc(client: RpcCaller): TransactionRpc {
  async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new RpcError(fn, error.code, error.message);
    return data;
  }

  return {
    async reserve(a) {
      const fn = "reserve_balance_and_create_transaction";
      const r = firstRow(fn, reserveRow, await call(fn, {
        p_user_id: a.userId, p_product_id: a.productId,
        p_destination: a.destination, p_idempotency_key: a.idempotencyKey,
        p_expected_price: a.expectedPrice ?? null,
      }));
      return { outcome: r.out_outcome, txId: r.out_tx_id, reffId: r.out_reff_id, status: r.out_status, amount: r.out_amount, balanceAfter: r.out_balance_after };
    },
    async syncProducts(a) {
      const fn = "sync_products";
      const r = firstRow(fn, syncRow, await call(fn, {
        p_provider: a.provider, p_products: a.products,
        p_default_margin: a.defaultMargin, p_activate_new: a.activateNew,
      }));
      return { inserted: r.out_inserted, updated: r.out_updated };
    },
    async finalizeSuccess(a) {
      const fn = "finalize_transaction_success";
      const r = firstRow(fn, finalizeRow, await call(fn, { p_reff_id: a.reffId, p_message: a.message ?? null, p_raw: a.raw ?? null }));
      return { outcome: r.out_outcome, txId: r.out_tx_id, status: r.out_status };
    },
    async finalizeFailed(a) {
      const fn = "finalize_transaction_failed";
      const r = firstRow(fn, finalizeRow, await call(fn, { p_reff_id: a.reffId, p_message: a.message ?? null, p_raw: a.raw ?? null }));
      return { outcome: r.out_outcome, txId: r.out_tx_id, status: r.out_status };
    },
    async claimSend(a) {
      const fn = "claim_provider_send";
      const r = firstRow(fn, claimRow, await call(fn, { p_reff_id: a.reffId }));
      return { claimed: r.out_claimed, txId: r.out_tx_id, reffId: r.out_reff_id, status: r.out_status, attempts: r.out_attempts };
    },
    async manualTopup(a) {
      const fn = "admin_manual_topup";
      const r = firstRow(fn, topupRow, await call(fn, {
        p_admin_id: a.adminId, p_user_id: a.userId, p_amount: a.amount,
        p_idempotency_key: a.idempotencyKey, p_note: a.note ?? null,
      }));
      return { outcome: r.out_outcome, ledgerId: r.out_ledger_id, balanceAfter: r.out_balance_after };
    },
    async logWebhookEvent(a) {
      const fn = "log_webhook_event";
      const r = firstRow(fn, eventRow, await call(fn, { p_provider: a.provider, p_dedupe_key: a.dedupeKey, p_reff_id: a.reffId, p_payload: a.payload }));
      return { eventId: r.out_event_id, receiveCount: r.out_receive_count };
    },
    async setWebhookOutcome(a) {
      await call("set_webhook_event_outcome", { p_event_id: a.eventId, p_outcome: a.outcome });
    },
  };
}
