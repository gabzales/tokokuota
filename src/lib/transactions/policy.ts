/**
 * Financial-processing switches. They are code constants (not env vars) on purpose: turning one
 * on is a reviewed change that must come with a real provider sample and tests.
 *
 * TAHAP 2B IS ON HOLD. Do not flip these until the real /trx and /history JSON is available.
 */
export const POLICY = {
  /**
   * Checkout NEVER finalizes a transaction from the /trx response. It has no finalize code path
   * at all; timeout, network error and unrecognised responses leave the transaction PENDING.
   * (Documentation constant: there is nothing to flip.)
   */
  FINALIZE_FROM_TRX_RESPONSE: false,
  /** Reconciliation via /history. Needs the real /history schema before it may touch money. */
  RECONCILE_ENABLED: false,
} as const;
