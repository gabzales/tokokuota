import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TransactionStatus } from "./types";

/** Server-side view of a transaction (includes reff_id; never sent to browsers). */
export interface TxRecord {
  id: string;
  userId: string;
  reffId: string;
  status: TransactionStatus;
  destination: string;
  providerCode: string;
  providerAttempts: number;
  needsReview: boolean;
}

/**
 * Non-money persistence used by checkout / webhook / reconciliation. Money and status changes
 * are NOT here: they only exist as database RPCs.
 */
export interface TransactionStore {
  getByReffId(reffId: string): Promise<TxRecord | null>;
  /** Server-only audit snapshot of the latest provider interaction (provider_raw). */
  saveProviderSnapshot(reffId: string, snapshot: unknown): Promise<void>;
  flagReview(reffId: string, note: string): Promise<void>;
  touchReconciled(reffId: string): Promise<void>;
  listPendingForReconcile(o: { olderThanMs: number; notReconciledWithinMs: number; limit: number }): Promise<TxRecord[]>;
}

const COLS = "id,user_id,reff_id,status,destination,provider_code,provider_attempts,needs_review";

const row = z.object({
  id: z.string(),
  user_id: z.string(),
  reff_id: z.string(),
  status: z.enum(["PENDING", "SUCCESS", "FAILED"]),
  destination: z.string(),
  provider_code: z.string(),
  provider_attempts: z.number().int(),
  needs_review: z.boolean(),
});

const toRecord = (r: z.infer<typeof row>): TxRecord => ({
  id: r.id,
  userId: r.user_id,
  reffId: r.reff_id,
  status: r.status,
  destination: r.destination,
  providerCode: r.provider_code,
  providerAttempts: r.provider_attempts,
  needsReview: r.needs_review,
});

export function createSupabaseTransactionStore(db: SupabaseClient): TransactionStore {
  return {
    async getByReffId(reffId) {
      const { data, error } = await db.from("transactions").select(COLS).eq("reff_id", reffId).maybeSingle();
      if (error) throw new Error(`store.getByReffId: ${error.message}`);
      return data ? toRecord(row.parse(data)) : null;
    },

    async saveProviderSnapshot(reffId, snapshot) {
      const { error } = await db
        .from("transactions")
        .update({ provider_raw: snapshot })
        .eq("reff_id", reffId)
        .eq("status", "PENDING");
      if (error) throw new Error(`store.saveProviderSnapshot: ${error.message}`);
    },

    async flagReview(reffId, note) {
      const { error } = await db
        .from("transactions")
        .update({ needs_review: true, review_note: note.slice(0, 2000) })
        .eq("reff_id", reffId);
      if (error) throw new Error(`store.flagReview: ${error.message}`);
    },

    async touchReconciled(reffId) {
      const { error } = await db
        .from("transactions")
        .update({ last_reconciled_at: new Date().toISOString() })
        .eq("reff_id", reffId)
        .eq("status", "PENDING");
      if (error) throw new Error(`store.touchReconciled: ${error.message}`);
    },

    async listPendingForReconcile(o) {
      const now = Date.now();
      const oldEnough = new Date(now - o.olderThanMs).toISOString();
      const staleCheck = new Date(now - o.notReconciledWithinMs).toISOString();
      const { data, error } = await db
        .from("transactions")
        .select(COLS)
        .eq("status", "PENDING")
        .gt("provider_attempts", 0) // only transactions that were actually sent to the provider
        .lt("created_at", oldEnough)
        .or(`last_reconciled_at.is.null,last_reconciled_at.lt.${staleCheck}`)
        .order("created_at", { ascending: true })
        .limit(o.limit);
      if (error) throw new Error(`store.listPendingForReconcile: ${error.message}`);
      return (data ?? []).map((r) => toRecord(row.parse(r)));
    },
  };
}
