import pg from "pg";
import type { RpcCaller } from "@/lib/transactions/rpc";
import type { TransactionStore, TxRecord } from "@/lib/transactions/store";

// bigint columns come back as strings by default; rupiah are far below 2^53.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

/** Real PostgreSQL behind the same RpcCaller / TransactionStore interfaces production uses. */
export function pgRpc(pool: pg.Pool): RpcCaller {
  return {
    async rpc(fn, args = {}) {
      if (!/^[a-z_]+$/.test(fn)) throw new Error("bad function name");
      const keys = Object.keys(args);
      const params = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
      const values = keys.map((k) => {
        const v = args[k];
        return Array.isArray(v) || (v !== null && typeof v === "object") ? JSON.stringify(v) : v;
      });
      try {
        const r = await pool.query(`select * from public.${fn}(${params})`, values);
        return { data: r.rows, error: null };
      } catch (e) {
        const err = e as { message: string; code?: string };
        return { data: null, error: { message: err.message, code: err.code } };
      }
    },
  };
}

const COLS = "id,user_id,reff_id,status,destination,provider_code,provider_attempts,needs_review";
type Row = { id: string; user_id: string; reff_id: string; status: TxRecord["status"]; destination: string; provider_code: string; provider_attempts: number; needs_review: boolean };
const toRecord = (r: Row): TxRecord => ({
  id: r.id, userId: r.user_id, reffId: r.reff_id, status: r.status, destination: r.destination,
  providerCode: r.provider_code, providerAttempts: r.provider_attempts, needsReview: r.needs_review,
});

export function pgStore(pool: pg.Pool): TransactionStore {
  return {
    async getByReffId(reffId) {
      const r = await pool.query<Row>(`select ${COLS} from public.transactions where reff_id = $1`, [reffId]);
      return r.rows[0] ? toRecord(r.rows[0]) : null;
    },
    async saveProviderSnapshot(reffId, snapshot) {
      await pool.query(`update public.transactions set provider_raw = $2::jsonb where reff_id = $1 and status = 'PENDING'`, [reffId, JSON.stringify(snapshot)]);
    },
    async flagReview(reffId, note) {
      await pool.query(`update public.transactions set needs_review = true, review_note = $2 where reff_id = $1`, [reffId, note.slice(0, 2000)]);
    },
    async touchReconciled(reffId) {
      await pool.query(`update public.transactions set last_reconciled_at = now() where reff_id = $1 and status = 'PENDING'`, [reffId]);
    },
    async listPendingForReconcile() {
      const r = await pool.query<Row>(`select ${COLS} from public.transactions where status = 'PENDING' and provider_attempts > 0`);
      return r.rows.map(toRecord);
    },
  };
}
