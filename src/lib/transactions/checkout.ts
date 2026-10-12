import type { ProviderAdapter, SubmitOutcome } from "@/lib/providers/types";
import { redactAndTruncate } from "@/lib/security/redact";
import type { TransactionRpc } from "./rpc";
import type { TransactionStore } from "./store";
import type { ReserveOutcome, TransactionStatus } from "./types";

export type CheckoutFailureCode =
  | Exclude<ReserveOutcome, "CREATED" | "EXISTING">
  | "PROVIDER_NOT_READY"
  | "INVALID_INPUT";

/**
 * How the provider step ended. In EVERY case the transaction is still PENDING:
 *  SUBMITTED        an HTTP answer arrived (it is stored, not interpreted)
 *  UNCERTAIN        timeout / network / non-2xx: the provider may or may not have it
 *  FLAGGED          unexpected error while sending: marked for review
 *  ALREADY_HANDLED  a repeat of an earlier checkout (idempotent): nothing was sent again
 */
export type SubmissionState = "SUBMITTED" | "UNCERTAIN" | "FLAGGED" | "ALREADY_HANDLED";

export type CheckoutResult =
  | { ok: true; txId: string; status: TransactionStatus; created: boolean; submission: SubmissionState }
  | { ok: false; code: CheckoutFailureCode; currentPrice?: number };

export interface CheckoutDeps {
  rpc: TransactionRpc;
  store: TransactionStore;
  provider: ProviderAdapter;
  /** Secrets that must never reach storage (e.g. the provider API key). */
  secrets: readonly string[];
}

export interface CheckoutRequest {
  userId: string;
  productId: string;
  destination: string;
  idempotencyKey: string;
  expectedPrice?: number;
}

function snapshotOf(outcome: SubmitOutcome, secrets: readonly string[]) {
  if (outcome.kind === "transport_uncertain") {
    return { at: new Date().toISOString(), kind: "transport_uncertain", reason: outcome.reason, httpStatus: outcome.httpStatus ?? null };
  }
  return {
    at: new Date().toISOString(),
    kind: "response",
    httpStatus: outcome.raw.httpStatus,
    contentType: outcome.raw.contentType,
    body: redactAndTruncate(outcome.raw.bodyText, secrets),
    parsed: outcome.parsed !== null, // always false until the real /trx sample is mapped
  };
}

export type SendResult =
  | { ok: true; txId: string; status: TransactionStatus; submission: SubmissionState }
  | { ok: false; code: "PROVIDER_NOT_READY" | "NOT_FOUND" };

/**
 * The ONLY place that sends /trx. It first CLAIMS the transaction with an atomic database
 * compare-and-set (claim_provider_send: provider_attempts 0 -> 1). Exactly one caller can win
 * that claim, however many requests race (checkout repeats, recovery, admin resend); every
 * other caller gets ALREADY_HANDLED and never touches the provider. Never "read attempts, then
 * decide": that would let two requests both see 0.
 *
 * No finalize/refund call exists here: the final state comes only from a parsed + validated
 * webhook or from reconciliation (Tahap 2B).
 */
export async function sendIfClaimed(
  deps: Pick<CheckoutDeps, "rpc" | "store" | "provider" | "secrets">,
  reffId: string,
): Promise<SendResult> {
  try {
    deps.provider.assertReady();
  } catch {
    return { ok: false, code: "PROVIDER_NOT_READY" };
  }

  // productCode / destination are immutable columns, so reading them before the claim is race-free.
  const tx = await deps.store.getByReffId(reffId);
  if (!tx) return { ok: false, code: "NOT_FOUND" };

  const claim = await deps.rpc.claimSend({ reffId });
  if (!claim.claimed) {
    return { ok: true, txId: claim.txId ?? tx.id, status: claim.status ?? tx.status, submission: "ALREADY_HANDLED" };
  }

  let outcome: SubmitOutcome;
  try {
    outcome = await deps.provider.createTransaction({
      reffId: tx.reffId,
      productCode: tx.providerCode,
      destination: tx.destination,
    });
  } catch (err) {
    await deps.store.flagReview(tx.reffId, `Unexpected error while sending /trx: ${err instanceof Error ? err.name : "unknown"}`);
    return { ok: true, txId: tx.id, status: "PENDING", submission: "FLAGGED" };
  }

  await deps.store.saveProviderSnapshot(tx.reffId, snapshotOf(outcome, deps.secrets));
  return { ok: true, txId: tx.id, status: "PENDING", submission: outcome.kind === "response" ? "SUBMITTED" : "UNCERTAIN" };
}

/**
 * Checkout orchestration:
 *   1. prove the provider request can be built (before any money moves)
 *   2. atomically reserve balance + create the PENDING transaction (DB, price from DB)
 *   3. sendIfClaimed: claim, send /trx at most once with the transaction's own reff_id, store raw.
 */
export async function performCheckout(deps: CheckoutDeps, req: CheckoutRequest): Promise<CheckoutResult> {
  try {
    deps.provider.assertReady();
  } catch {
    return { ok: false, code: "PROVIDER_NOT_READY" };
  }

  const r = await deps.rpc.reserve({
    userId: req.userId,
    productId: req.productId,
    destination: req.destination,
    idempotencyKey: req.idempotencyKey,
    expectedPrice: req.expectedPrice ?? null,
  });

  if (r.outcome !== "CREATED" && r.outcome !== "EXISTING") {
    return { ok: false, code: r.outcome, currentPrice: r.outcome === "PRICE_CHANGED" ? (r.amount ?? undefined) : undefined };
  }
  if (!r.txId || !r.reffId || !r.status) throw new Error("reserve returned an incomplete row");

  const sent = await sendIfClaimed(deps, r.reffId);
  if (!sent.ok) {
    if (sent.code === "PROVIDER_NOT_READY") return { ok: false, code: "PROVIDER_NOT_READY" };
    throw new Error("transaction vanished after reserve");
  }
  return { ok: true, txId: sent.txId, status: sent.status, created: r.outcome === "CREATED", submission: sent.submission };
}

export function checkoutErrorMessage(code: CheckoutFailureCode): string {
  switch (code) {
    case "INSUFFICIENT_BALANCE": return "Saldo tidak cukup.";
    case "PRODUCT_UNAVAILABLE": return "Produk sedang tidak tersedia.";
    case "PRICE_CHANGED": return "Harga produk berubah. Muat ulang halaman untuk melihat harga terbaru.";
    case "INVALID_DESTINATION": return "Nomor/ID tujuan tidak valid.";
    case "USER_INACTIVE": return "Akun tidak aktif. Hubungi admin.";
    case "MAINTENANCE": return "Sistem sedang dalam pemeliharaan. Coba lagi beberapa saat lagi.";
    case "USER_NOT_FOUND": return "Akun tidak ditemukan. Silakan login ulang.";
    case "PROVIDER_NOT_READY": return "Layanan sedang tidak dapat memproses transaksi. Coba lagi nanti.";
    case "INVALID_INPUT": return "Data tidak valid.";
  }
}

/** HTTP status for the JSON endpoint (the form flow uses the message instead). */
export function checkoutHttpStatus(code: CheckoutFailureCode): number {
  switch (code) {
    case "INSUFFICIENT_BALANCE": return 402;
    case "PRODUCT_UNAVAILABLE":
    case "PRICE_CHANGED": return 409;
    case "INVALID_DESTINATION":
    case "INVALID_INPUT": return 422;
    case "USER_INACTIVE": return 403;
    case "USER_NOT_FOUND": return 401;
    case "PROVIDER_NOT_READY":
    case "MAINTENANCE": return 503;
  }
}
