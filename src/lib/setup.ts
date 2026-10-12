import { z } from "zod";
import { RpcError, type RpcCaller } from "@/lib/transactions/rpc";

export const setupSchema = z
  .object({
    secret: z.string().min(1, "Secret wajib diisi").max(200),
    email: z.string().trim().toLowerCase().email("Email tidak valid").max(254),
    password: z.string().min(8, "Password minimal 8 karakter").max(72, "Password maksimal 72 karakter"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Konfirmasi password tidak sama" });

/** Thin wrapper over the 0008 functions (service_role only). */
export function createSetupRpc(client: RpcCaller) {
  async function call(fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new RpcError(fn, error.code, error.message);
    return data;
  }
  return {
    async isNeeded(): Promise<boolean> {
      return (await call("setup_needed")) === true;
    },
    /** A fresh single-use invite for the first admin's signup, or null when an admin already exists. */
    async issueInvite(): Promise<string | null> {
      const v = await call("bootstrap_admin_invite");
      return typeof v === "string" && v ? v : null;
    },
    /** True only if this user became THE admin (false: somebody else got there first). */
    async promote(userId: string): Promise<boolean> {
      return (await call("bootstrap_promote_admin", { p_user_id: userId })) === true;
    },
  };
}
