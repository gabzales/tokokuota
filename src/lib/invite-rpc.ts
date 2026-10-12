import { z } from "zod";
import { RpcError, type RpcCaller } from "@/lib/transactions/rpc";

const createRow = z.object({ out_id: z.string(), out_code: z.string(), out_expires_at: z.coerce.date().transform((d) => d.toISOString()) });
const outcomeRow = z.object({ out_outcome: z.enum(["REVOKED", "NOT_FOUND", "ALREADY_USED", "ALREADY_REVOKED"]) });

function firstRow<T extends z.ZodTypeAny>(fn: string, schema: T, data: unknown): z.infer<T> {
  const parsed = schema.safeParse((Array.isArray(data) ? data : [data])[0]);
  if (!parsed.success) throw new RpcError(fn, undefined, `unexpected response shape (${parsed.error.issues[0]?.message})`);
  return parsed.data;
}

export function createInviteRpc(client: RpcCaller) {
  async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new RpcError(fn, error.code, error.message);
    return data;
  }
  return {
    /** Read-only check for the register page. The database trigger is what actually enforces the code. */
    async isValid(code: string): Promise<boolean> {
      return (await call("invite_code_valid", { p_code: code })) === true;
    },
    async create(a: { adminId: string; note: string; validDays: number }) {
      const fn = "admin_create_invite_code";
      const r = firstRow(fn, createRow, await call(fn, { p_admin_id: a.adminId, p_note: a.note, p_valid_days: a.validDays }));
      return { id: r.out_id, code: r.out_code, expiresAt: r.out_expires_at };
    },
    async revoke(a: { adminId: string; id: string }) {
      const fn = "admin_revoke_invite_code";
      return firstRow(fn, outcomeRow, await call(fn, { p_admin_id: a.adminId, p_id: a.id })).out_outcome;
    },
  };
}
