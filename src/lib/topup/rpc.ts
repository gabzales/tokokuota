import { z } from "zod";
import { RpcError, type RpcCaller } from "@/lib/transactions/rpc";

export type TopupStatus = "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";
export type CreateTopupOutcome =
  | "CREATED" | "EXISTING" | "TOPUP_DISABLED" | "USER_NOT_FOUND" | "USER_INACTIVE" | "BANK_UNAVAILABLE"
  | "AMOUNT_OUT_OF_RANGE" | "TOO_MANY_PENDING" | "NO_CODE_AVAILABLE";

const num = z.number().int();
const status = z.enum(["PENDING", "PAID", "EXPIRED", "CANCELLED"]);
// PostgREST returns ISO strings, node-postgres returns Date: accept both.
const ts = z.coerce.date().nullable().transform((d) => (d ? d.toISOString() : null));

const createRow = z.object({
  out_outcome: z.enum(["CREATED", "EXISTING", "TOPUP_DISABLED", "USER_NOT_FOUND", "USER_INACTIVE", "BANK_UNAVAILABLE", "AMOUNT_OUT_OF_RANGE", "TOO_MANY_PENDING", "NO_CODE_AVAILABLE"]),
  out_request_id: z.string().nullable(), out_bank_code: z.string().nullable(), out_base_amount: num.nullable(),
  out_unique_code: num.nullable(), out_total_amount: num.nullable(), out_expires_at: ts, out_status: status.nullable(),
});
const simpleRow = z.object({ out_outcome: z.string() });
const transferRow = z.object({
  out_outcome: z.enum(["CREDITED", "QUEUED", "ALREADY_RECORDED"]),
  out_transfer_id: z.string().nullable(), out_request_id: z.string().nullable(), out_user_id: z.string().nullable(),
});
const balanceRow = z.object({ out_outcome: z.string(), out_balance_after: num.nullable() });

function firstRow<T extends z.ZodTypeAny>(fn: string, schema: T, data: unknown): z.infer<T> {
  const rows = Array.isArray(data) ? data : [data];
  const parsed = schema.safeParse(rows[0]);
  if (!parsed.success) throw new RpcError(fn, undefined, `unexpected response shape (${parsed.error.issues[0]?.message})`);
  return parsed.data;
}

export interface CreateTopupResult {
  outcome: CreateTopupOutcome;
  requestId: string | null; bankCode: string | null; baseAmount: number | null; uniqueCode: number | null;
  totalAmount: number | null; expiresAt: string | null; status: TopupStatus | null;
}
export type TransferOutcome = "CREDITED" | "QUEUED" | "ALREADY_RECORDED";

/** Provider-neutral shape of "money arrived". Tahap 4B maps a mutation-service payload onto this. */
export interface IncomingTransfer {
  bankCode: string;
  amount: number;
  /** The bank/mutation service's unique id for this transaction (the idempotency key). */
  bankRef: string;
  occurredAt?: string | null;
  raw?: unknown;
}

export function createTopupRpc(client: RpcCaller) {
  async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new RpcError(fn, error.code, error.message);
    return data;
  }
  return {
    async createRequest(a: { userId: string; bankCode: string; baseAmount: number; idempotencyKey: string }): Promise<CreateTopupResult> {
      const fn = "create_topup_request";
      const r = firstRow(fn, createRow, await call(fn, { p_user_id: a.userId, p_bank_code: a.bankCode, p_base_amount: a.baseAmount, p_idempotency_key: a.idempotencyKey }));
      return { outcome: r.out_outcome, requestId: r.out_request_id, bankCode: r.out_bank_code, baseAmount: r.out_base_amount, uniqueCode: r.out_unique_code, totalAmount: r.out_total_amount, expiresAt: r.out_expires_at, status: r.out_status };
    },
    async cancelRequest(a: { userId: string; requestId: string }): Promise<string> {
      const fn = "cancel_topup_request";
      return firstRow(fn, simpleRow, await call(fn, { p_user_id: a.userId, p_request_id: a.requestId })).out_outcome;
    },
    async recordIncomingTransfer(t: IncomingTransfer) {
      const fn = "record_incoming_transfer";
      const r = firstRow(fn, transferRow, await call(fn, {
        p_bank_code: t.bankCode, p_amount: t.amount, p_bank_ref: t.bankRef, p_occurred_at: t.occurredAt ?? null, p_raw: t.raw ?? null,
      }));
      return { outcome: r.out_outcome as TransferOutcome, transferId: r.out_transfer_id, requestId: r.out_request_id, userId: r.out_user_id };
    },
    async adminConfirmRequest(a: { adminId: string; requestId: string; note: string }) {
      const fn = "admin_confirm_topup_request";
      const r = firstRow(fn, balanceRow, await call(fn, { p_admin_id: a.adminId, p_request_id: a.requestId, p_note: a.note }));
      return { outcome: r.out_outcome, balanceAfter: r.out_balance_after };
    },
    async adminResolveTransfer(a: { adminId: string; transferId: string; action: "CREDIT" | "IGNORE"; userId: string | null; note: string }) {
      const fn = "admin_resolve_transfer";
      const r = firstRow(fn, balanceRow, await call(fn, { p_admin_id: a.adminId, p_transfer_id: a.transferId, p_action: a.action, p_user_id: a.userId, p_note: a.note }));
      return { outcome: r.out_outcome, balanceAfter: r.out_balance_after };
    },
    async upsertBank(a: { adminId: string; code: string; bankName: string; accountNumber: string; accountHolder: string; isActive: boolean; sortOrder: number }) {
      const fn = "admin_upsert_topup_bank";
      return firstRow(fn, simpleRow, await call(fn, {
        p_admin_id: a.adminId, p_code: a.code, p_bank_name: a.bankName, p_account_number: a.accountNumber,
        p_account_holder: a.accountHolder, p_is_active: a.isActive, p_sort_order: a.sortOrder,
      })).out_outcome;
    },
    async expireStale(): Promise<number> {
      const data = await call("expire_topup_requests", {});
      const v = Array.isArray(data) ? Object.values((data[0] ?? {}) as Record<string, unknown>)[0] : data;
      return z.number().int().parse(v);
    },
  };
}
export type TopupRpc = ReturnType<typeof createTopupRpc>;

/** The one door for Tahap 4B: whatever detects the transfer ends up here. */
export async function ingestIncomingTransfer(rpc: Pick<TopupRpc, "recordIncomingTransfer">, t: IncomingTransfer) {
  if (!Number.isInteger(t.amount) || t.amount <= 0) throw new Error("amount must be a positive integer (rupiah)");
  if (!t.bankRef.trim()) throw new Error("bankRef is required");
  return rpc.recordIncomingTransfer({ ...t, bankCode: t.bankCode.toUpperCase(), bankRef: t.bankRef.trim() });
}
