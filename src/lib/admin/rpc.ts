import { RpcError, type RpcCaller } from "@/lib/transactions/rpc";

/** Typed wrappers for the admin mutation RPCs. Each one re-checks the admin inside Postgres. */
export function createAdminMutations(client: RpcCaller) {
  async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new RpcError(fn, error.code, error.message);
    return (Array.isArray(data) ? data : data == null ? [] : [data]) as Record<string, unknown>[];
  }
  const outcome = (rows: Record<string, unknown>[]) => String(rows[0]?.out_outcome ?? "");

  return {
    async updateProduct(a: { adminId: string; productId: string; changes: Record<string, unknown> }) {
      const rows = await call("admin_update_product", { p_admin_id: a.adminId, p_product_id: a.productId, p_changes: a.changes });
      return { outcome: outcome(rows), sellPrice: (rows[0]?.out_sell_price as number | null) ?? null };
    },
    async bulkSetMargin(a: { adminId: string; mode: "FLAT" | "PERCENT"; value: number; category: string | null; onlyActive: boolean }) {
      const rows = await call("admin_bulk_set_margin", { p_admin_id: a.adminId, p_mode: a.mode, p_value: a.value, p_category: a.category, p_only_active: a.onlyActive });
      return { updated: Number(rows[0]?.out_updated ?? 0) };
    },
    async setUserFlags(a: { adminId: string; userId: string; changes: { is_active: boolean; role: "user" | "admin" } }) {
      return outcome(await call("admin_set_user_flags", { p_admin_id: a.adminId, p_user_id: a.userId, p_changes: a.changes }));
    },
    async resolveReview(a: { adminId: string; reffId: string; note: string }) {
      return outcome(await call("admin_resolve_review", { p_admin_id: a.adminId, p_reff_id: a.reffId, p_note: a.note }));
    },
    async updateSettings(a: { adminId: string; changes: Record<string, unknown> }) {
      await call("admin_update_settings", { p_admin_id: a.adminId, p_changes: a.changes });
    },
  };
}
export type AdminMutations = ReturnType<typeof createAdminMutations>;

/** Database errors -> short Indonesian messages (never leak SQL text to the page). */
export function describeAdminError(e: unknown): string {
  const code = e instanceof RpcError ? e.code : undefined;
  switch (code) {
    case "42501": return "Akses ditolak.";
    case "54000": return "Batas kredit manual harian untuk akun admin ini sudah tercapai. Coba lagi besok atau naikkan batasnya di Pengaturan.";
    case "22023": return "Input tidak valid.";
    case "23514": return "Nilai melanggar batasan data (mis. harga jual harus lebih dari 0).";
    case "22P02": return "Format nilai tidak valid.";
    default: return "Terjadi gangguan. Coba lagi.";
  }
}
