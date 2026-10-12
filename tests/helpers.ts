import { vi } from "vitest";
import type { ProviderAdapter, SubmitOutcome } from "@/lib/providers/types";
import type { TransactionRpc } from "@/lib/transactions/rpc";
import type { TransactionStore, TxRecord } from "@/lib/transactions/store";

export const tx = (over: Partial<TxRecord> = {}): TxRecord => ({
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  reffId: "TKAAAAAAAAAAAAAAAAAA",
  status: "PENDING",
  destination: "081234567890",
  providerCode: "PC1",
  providerAttempts: 0,
  needsReview: false,
  ...over,
});

export function fakeStore(record: TxRecord | null = tx()) {
  return {
    getByReffId: vi.fn(async () => record),
    saveProviderSnapshot: vi.fn(async () => {}),
    flagReview: vi.fn(async () => {}),
    touchReconciled: vi.fn(async () => {}),
    listPendingForReconcile: vi.fn(async () => (record ? [record] : [])),
  } satisfies TransactionStore;
}

export function fakeRpc(over: Partial<Record<keyof TransactionRpc, unknown>> = {}) {
  const base = {
    reserve: vi.fn(async () => ({ outcome: "CREATED", txId: "t", reffId: "TKAAAAAAAAAAAAAAAAAA", status: "PENDING", amount: 10000, balanceAfter: 1 })),
    syncProducts: vi.fn(async () => ({ inserted: 1, updated: 0 })),
    finalizeSuccess: vi.fn(async () => ({ outcome: "APPLIED", txId: "t", status: "SUCCESS" })),
    finalizeFailed: vi.fn(async () => ({ outcome: "APPLIED", txId: "t", status: "FAILED" })),
    claimSend: vi.fn(async () => ({ claimed: true, txId: "t", reffId: "TKAAAAAAAAAAAAAAAAAA", status: "PENDING", attempts: 1 })),
    manualTopup: vi.fn(),
    logWebhookEvent: vi.fn(async () => ({ eventId: 7, receiveCount: 1 })),
    setWebhookOutcome: vi.fn(async () => {}),
    ...over,
  };
  return base as unknown as TransactionRpc & typeof base;
}

export function fakeProvider(over: Partial<ProviderAdapter> = {}) {
  const outcome: SubmitOutcome = { kind: "response", raw: { httpStatus: 200, contentType: "application/json", bodyText: '{"x":1}', json: { x: 1 } }, parsed: null };
  const base = {
    id: "khfypay",
    assertReady: vi.fn(),
    listProducts: vi.fn(async () => ({ kind: "unparsed" as const, raw: outcome.kind === "response" ? outcome.raw : (undefined as never) })),
    createTransaction: vi.fn(async () => outcome),
    getHistory: vi.fn(async () => ({ kind: "unparsed" as const, raw: (outcome as Extract<SubmitOutcome, { kind: "response" }>).raw })),
    checkAkrabStock: vi.fn(),
    ...over,
  };
  return base as unknown as ProviderAdapter & typeof base;
}
