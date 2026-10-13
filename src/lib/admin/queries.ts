import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { PAGE } from "./list-params";

async function rows<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await createAdminClient().rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return (data ?? []) as T[];
}
const paging = (page: number) => ({ p_limit: PAGE + 1, p_offset: (page - 1) * PAGE });

export interface UserRow { id: string; email: string | null; full_name: string | null; role: string; saldo: number; is_active: boolean; created_at: string }
export interface TxRow {
  id: string; reff_id: string; user_id: string; user_email: string | null; product_name: string; destination: string;
  cost_price: number; sell_price: number; status: string; provider_attempts: number; needs_review: boolean;
  created_at: string; finalized_at: string | null; last_reconciled_at: string | null;
}
export interface LedgerRow {
  id: number; user_id: string; user_email: string | null; type: string; amount: number; balance_before: number; balance_after: number;
  transaction_id: string | null; note: string | null; created_by_email: string | null; created_at: string;
}
export interface ProductRow {
  id: string; provider_code: string; name: string; display_name: string | null; category: string | null; display_category: string | null;
  cost_price: number; margin: number; sell_price: number; is_active: boolean; is_available: boolean; sort_order: number; synced_at: string;
}
export interface WebhookRow {
  id: number; provider: string; reff_id: string | null; outcome: string | null; receive_count: number;
  first_received_at: string; last_received_at: string; message: string;
}
export interface AuditRow { id: number; admin_email: string | null; action: string; target_type: string | null; target_id: string | null; details: Record<string, unknown>; created_at: string }
export interface TopupRow {
  id: string; user_id: string; user_email: string | null; bank_code: string; base_amount: number; unique_code: number; total_amount: number;
  status: string; expires_at: string; paid_at: string | null; bank_ref: string | null; created_at: string;
}
export interface TransferRow {
  id: string; bank_code: string; bank_ref: string; amount: number; occurred_at: string; status: string; reason: string | null;
  request_id: string | null; credited_user_id: string | null; credited_user_email: string | null; resolved_note: string | null; created_at: string;
}
export interface BankRow { id: string; code: string; bank_name: string; account_number: string; account_holder: string; is_active: boolean; sort_order: number }
export interface DashboardStats {
  topup_pending: number; topup_queued: number;
  users_total: number; users_active: number; saldo_total: number;
  since_pending: number; since_success: number; since_failed: number; since_revenue: number; since_profit: number;
  pending_total: number; unsent: number; stale_pending: number; needs_review: number; webhook_unresolved_24h: number;
}

export const listUsers = (f: { q?: string; role?: string; active?: boolean; page: number }) =>
  rows<UserRow>("admin_list_users", { p_search: f.q ?? null, p_role: f.role ?? null, p_active: f.active ?? null, ...paging(f.page) });

export const listTransactions = (f: { q?: string; status?: string; view?: "review" | "unsent" | "stale"; user?: string; page: number; limit?: number }) =>
  rows<TxRow>("admin_list_transactions", {
    p_status: f.status ?? null,
    p_needs_review: f.view === "review" ? true : null,
    p_unsent: f.view === "unsent" ? true : null,
    p_stale: f.view === "stale" ? true : null,
    p_user_id: f.user ?? null,
    p_search: f.q ?? null,
    p_limit: f.limit ?? PAGE + 1,
    p_offset: (f.page - 1) * PAGE,
  });

export const listLedger = (f: { q?: string; type?: string; user?: string; page: number }) =>
  rows<LedgerRow>("admin_list_ledger", { p_type: f.type ?? null, p_user_id: f.user ?? null, p_search: f.q ?? null, ...paging(f.page) });

export const listProducts = (f: { q?: string; category?: string; active?: boolean; page: number }) =>
  rows<ProductRow>("admin_list_products", { p_search: f.q ?? null, p_category: f.category ?? null, p_active: f.active ?? null, ...paging(f.page) });

export const listWebhookEvents = (f: { unresolved?: boolean; page: number; limit?: number }) =>
  rows<WebhookRow>("admin_list_webhook_events", { p_unresolved: f.unresolved ?? null, p_limit: f.limit ?? PAGE + 1, p_offset: (f.page - 1) * PAGE });

export const listAudit = (page: number) => rows<AuditRow>("admin_list_audit", paging(page));

export async function getDashboardStats(sinceIso: string): Promise<DashboardStats> {
  const { data, error } = await createAdminClient().rpc("admin_dashboard_stats", { p_since: sinceIso });
  if (error) throw new Error(`admin_dashboard_stats failed: ${error.message}`);
  return data as DashboardStats;
}

export async function getUserById(id: string) {
  const { data, error } = await createAdminClient()
    .from("profiles").select("id,email,full_name,role,saldo,is_active,created_at").eq("id", id).maybeSingle();
  if (error) throw new Error(`profile read failed: ${error.message}`);
  return data as UserRow | null;
}

export async function getTransactionById(id: string) {
  const db = createAdminClient();
  const { data, error } = await db
    .from("transactions")
    .select("id,reff_id,user_id,product_id,provider_code,product_name,destination,cost_price,sell_price,status,provider_message,provider_raw,provider_attempts,provider_submitted_at,last_reconciled_at,needs_review,review_note,finalized_at,created_at,updated_at")
    .eq("id", id).maybeSingle();
  if (error) throw new Error(`transaction read failed: ${error.message}`);
  if (!data) return null;
  const [owner, ledger] = await Promise.all([
    db.from("profiles").select("id,email,full_name").eq("id", data.user_id).maybeSingle(),
    db.from("balance_ledger").select("id,type,amount,balance_before,balance_after,note,created_at").eq("transaction_id", id).order("id"),
  ]);
  return { tx: data, owner: owner.data as { id: string; email: string | null; full_name: string | null } | null, ledger: (ledger.data ?? []) as Pick<LedgerRow, "id" | "type" | "amount" | "balance_before" | "balance_after" | "note" | "created_at">[] };
}

export async function getProductById(id: string) {
  const { data, error } = await createAdminClient()
    .from("products_cache")
    .select("id,provider,provider_code,name,display_name,category,display_category,description,cost_price,margin,sell_price,is_active,is_available,sort_order,synced_at,raw")
    .eq("id", id).maybeSingle();
  if (error) throw new Error(`product read failed: ${error.message}`);
  return data;
}

export async function findBalanceMismatches() {
  const { data, error } = await createAdminClient().rpc("find_balance_mismatches");
  if (error) throw new Error(`find_balance_mismatches failed: ${error.message}`);
  return (data ?? []) as { out_user_id: string; out_saldo: number; out_ledger_sum: number }[];
}

export const listTopups = (f: { status?: string; q?: string; page: number }) =>
  rows<TopupRow>("admin_list_topups", { p_status: f.status ?? null, p_search: f.q ?? null, ...paging(f.page) });

export const listTransfers = (f: { status?: string; page: number; limit?: number }) =>
  rows<TransferRow>("admin_list_transfers", { p_status: f.status ?? null, p_limit: f.limit ?? PAGE + 1, p_offset: (f.page - 1) * PAGE });

export async function listBanks() {
  const { data, error } = await createAdminClient().from("topup_banks")
    .select("id,code,bank_name,account_number,account_holder,is_active,sort_order").order("sort_order").order("code");
  if (error) throw new Error(`topup_banks read failed: ${error.message}`);
  return (data ?? []) as BankRow[];
}

export interface ExportTxRow {
  created_at: string; reff_id: string; user_email: string | null; product_name: string; provider_code: string; destination: string;
  cost_price: number; sell_price: number; profit: number; status: string; provider_attempts: number; needs_review: boolean; finalized_at: string | null;
}
export interface ExportLedgerRow {
  created_at: string; user_email: string | null; type: string; amount: number; balance_before: number; balance_after: number;
  transaction_reff_id: string | null; note: string | null; created_by_email: string | null;
}
export const exportTransactions = (adminId: string, fromIso: string, toIso: string, status?: string) =>
  rows<ExportTxRow>("admin_export_transactions", { p_admin_id: adminId, p_from: fromIso, p_to: toIso, p_status: status ?? null });
export const exportLedger = (adminId: string, fromIso: string, toIso: string, type?: string) =>
  rows<ExportLedgerRow>("admin_export_ledger", { p_admin_id: adminId, p_from: fromIso, p_to: toIso, p_type: type ?? null });

export interface InviteRow {
  id: string; code: string; note: string | null; expires_at: string; created_at: string;
  revoked_at: string | null; used_at: string | null; used_email: string | null;
}
export async function listInvites(limit = 100) {
  const { data, error } = await createAdminClient().from("invite_codes")
    .select("id,code,note,expires_at,created_at,revoked_at,used_at,used_email").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`invite_codes read failed: ${error.message}`);
  return (data ?? []) as InviteRow[];
}

export interface DiagLogRow {
  id: number; created_at: string; check_id: string; status: string; code: string;
  http_status: number | null; latency_ms: number | null; summary: string; detail: string | null;
}
/** null = table missing (migration 0009 not run yet) or unreadable. */
export async function listDiagLogs(limit = 40): Promise<DiagLogRow[] | null> {
  const { data, error } = await createAdminClient().from("diagnostic_logs")
    .select("id,created_at,check_id,status,code,http_status,latency_ms,summary,detail").order("id", { ascending: false }).limit(limit);
  return error ? null : ((data ?? []) as DiagLogRow[]);
}

export interface WebhookPayloadRow {
  id: number; first_received_at: string; last_received_at: string; receive_count: number;
  outcome: string | null; reff_id: string | null; payload: unknown;
}
export async function listWebhookPayloads(limit = 20): Promise<WebhookPayloadRow[] | null> {
  const { data, error } = await createAdminClient().from("provider_webhook_events")
    .select("id,first_received_at,last_received_at,receive_count,outcome,reff_id,payload").order("last_received_at", { ascending: false }).limit(limit);
  return error ? null : ((data ?? []) as WebhookPayloadRow[]);
}
