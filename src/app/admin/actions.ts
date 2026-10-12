"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { getAdminActor } from "@/lib/admin/auth";
import { adminLabel, notify } from "@/lib/alerts/server";
import { createAdminMutations, describeAdminError } from "@/lib/admin/rpc";
import { createInviteRpc } from "@/lib/invite-rpc";
import {
  bulkMarginSchema, inviteCreateSchema, inviteRevokeSchema, productUpdateSchema, resolveReviewSchema, sendUnsentSchema, topupSchema, userFlagsSchema,
} from "@/lib/admin/schemas";
import { findBalanceMismatches } from "@/lib/admin/queries";
import { failState, okState, type ActionState } from "@/lib/action-state";
import { CATALOG_TAG } from "@/lib/catalog/cache";
import { formatRupiah } from "@/lib/format";
import { settingsFormSchema, SETTINGS_TAG } from "@/lib/settings/keys";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSend } from "@/lib/transactions/checkout-runtime";
import { createTransactionRpc, type RpcCaller } from "@/lib/transactions/rpc";
import { createTopupRpc } from "@/lib/topup/rpc";
import { bankSchema, confirmTopupSchema, resolveTransferSchema } from "@/lib/topup/schemas";

// Every action: (1) the caller must be an active admin according to the DATABASE, (2) input is
// validated with zod, (3) the change is one RPC that re-checks admin and writes the audit log.

const DENIED = failState("Akses ditolak.");
const BIG_CREDIT = 1_000_000; // manual credits at or above this amount raise a warning alert
const firstIssue = (e: { issues: { message: string }[] }) => failState(e.issues[0]?.message ?? "Input tidak valid.");
const mutations = () => createAdminMutations(createAdminClient() as unknown as RpcCaller);

export async function updateProductAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getAdminActor();
  if (!actor) return DENIED;
  const adminId = actor.id;
  const parsed = productUpdateSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return firstIssue(parsed.error);
  const { productId, ...changes } = parsed.data;
  try {
    const r = await mutations().updateProduct({ adminId, productId, changes });
    if (r.outcome === "NOT_FOUND") return failState("Produk tidak ditemukan.");
    revalidateTag(CATALOG_TAG);
    revalidatePath("/admin/products");
    revalidatePath(`/admin/products/${productId}`);
    return okState(`Produk disimpan. Harga jual sekarang ${formatRupiah(r.sellPrice ?? 0)}.`);
  } catch (e) {
    return failState(describeAdminError(e));
  }
}

export async function bulkMarginAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getAdminActor();
  if (!actor) return DENIED;
  const adminId = actor.id;
  const parsed = bulkMarginSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const r = await mutations().bulkSetMargin({
      adminId, mode: parsed.data.mode, value: parsed.data.value,
      category: parsed.data.category || null, onlyActive: parsed.data.onlyActive,
    });
    revalidateTag(CATALOG_TAG);
    revalidatePath("/admin/products");
    return okState(`Margin diterapkan ke ${r.updated} produk.`);
  } catch (e) {
    return failState(describeAdminError(e));
  }
}

export async function topupAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getAdminActor();
  if (!actor) return DENIED;
  const adminId = actor.id;
  const parsed = topupSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const r = await createTransactionRpc(createAdminClient() as unknown as RpcCaller).manualTopup({
      adminId, userId: parsed.data.userId, amount: parsed.data.amount,
      idempotencyKey: parsed.data.idempotencyKey, note: parsed.data.note || null,
    });
    if (r.outcome === "USER_NOT_FOUND") return failState("User tidak ditemukan.");
    if (r.outcome === "APPLIED") notify({ severity: parsed.data.amount >= BIG_CREDIT ? "warn" : "info", title: "Top-up manual oleh admin", lines: [`Rp ${parsed.data.amount.toLocaleString("id-ID")} oleh ${adminLabel(actor)}`, `catatan: ${parsed.data.note || "-"}`] });
    revalidatePath(`/admin/users/${parsed.data.userId}`);
    revalidatePath("/admin/ledger");
    revalidatePath("/admin");
    return r.outcome === "ALREADY_APPLIED"
      ? okState(`Top-up ini sudah diproses sebelumnya. Saldo ${formatRupiah(r.balanceAfter ?? 0)}.`)
      : okState(`Top-up ${formatRupiah(parsed.data.amount)} berhasil. Saldo sekarang ${formatRupiah(r.balanceAfter ?? 0)}.`);
  } catch (e) {
    return failState(describeAdminError(e));
  }
}

export async function setUserFlagsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getAdminActor();
  if (!actor) return DENIED;
  const adminId = actor.id;
  const parsed = userFlagsSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return firstIssue(parsed.error);
  if (parsed.data.userId === adminId) return failState("Admin tidak bisa mengubah status/role akunnya sendiri.");
  try {
    const out = await mutations().setUserFlags({
      adminId, userId: parsed.data.userId, changes: { is_active: parsed.data.is_active, role: parsed.data.role },
    });
    if (out === "NOT_FOUND") return failState("User tidak ditemukan.");
    notify({ severity: parsed.data.role === "admin" ? "critical" : "warn", title: parsed.data.role === "admin" ? "Akun dijadikan ADMIN" : "Status/role akun diubah", lines: [`user ${parsed.data.userId.slice(0, 8)}: aktif=${parsed.data.is_active}, role=${parsed.data.role}`, `oleh ${adminLabel(actor)}`] });
    revalidatePath(`/admin/users/${parsed.data.userId}`);
    revalidatePath("/admin/users");
    return okState("Pengaturan akun disimpan.");
  } catch (e) {
    return failState(describeAdminError(e));
  }
}

export async function resolveReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getAdminActor();
  if (!actor) return DENIED;
  const adminId = actor.id;
  const parsed = resolveReviewSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const out = await mutations().resolveReview({ adminId, reffId: parsed.data.reffId, note: parsed.data.note });
    if (out === "NOT_FOUND") return failState("Transaksi tidak ditemukan.");
    if (out === "NOT_FLAGGED") return failState("Transaksi ini tidak sedang ditandai.");
    revalidatePath("/admin/transactions", "layout");
    revalidatePath("/admin/monitoring");
    revalidatePath("/admin");
    return okState("Tanda review ditutup. Status transaksi dan saldo tidak diubah.");
  } catch (e) {
    return failState(describeAdminError(e));
  }
}

/**
 * Sends a transaction that was reserved but NEVER handed to the provider. It goes through the same
 * atomic claim as checkout, so a double click, a concurrent recovery or a second admin cannot
 * send twice. A transaction that was already sent is refused.
 */
export async function sendUnsentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getAdminActor();
  if (!actor) return DENIED;
  const parsed = sendUnsentSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const { data } = await createAdminClient().from("transactions").select("reff_id").eq("id", parsed.data.transactionId).maybeSingle();
    if (!data) return failState("Transaksi tidak ditemukan.");
    const r = await runSend(data.reff_id as string);
    if (!r.ok) return failState(r.code === "PROVIDER_NOT_READY" ? "Konfigurasi provider belum lengkap." : "Transaksi tidak ditemukan.");
    revalidatePath(`/admin/transactions/${parsed.data.transactionId}`);
    revalidatePath("/admin/monitoring");
    if (r.submission === "ALREADY_HANDLED") return failState("Transaksi ini sudah pernah dikirim/diklaim, jadi TIDAK dikirim ulang.");
    return okState(
      r.submission === "UNCERTAIN"
        ? "Dikirim, tetapi provider tidak menjawab dengan jelas. Status tetap PENDING dan tidak ada refund otomatis."
        : "Dikirim ke provider. Status tetap PENDING sampai ada konfirmasi yang valid.",
    );
  } catch (e) {
    console.error("admin send failed", e instanceof Error ? e.message : e);
    return failState("Terjadi gangguan saat mengirim. Cek status transaksi sebelum mencoba lagi.");
  }
}

export async function updateSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getAdminActor();
  if (!actor) return DENIED;
  const adminId = actor.id;
  const parsed = settingsFormSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    await mutations().updateSettings({ adminId, changes: parsed.data });
    notify({ severity: "warn", title: "Pengaturan diubah", lines: [`maintenance=${parsed.data.maintenance_mode}, top-up=${parsed.data.topup_enabled}`, `oleh ${adminLabel(actor)}`] });
    revalidateTag(SETTINGS_TAG);
    revalidatePath("/admin/settings");
    return okState(parsed.data.maintenance_mode ? "Pengaturan disimpan. MODE PEMELIHARAAN AKTIF: pembelian baru diblokir." : "Pengaturan disimpan.");
  } catch (e) {
    return failState(describeAdminError(e));
  }
}

/** On-demand: the saldo-vs-ledger check scans the whole ledger, so it is not part of the dashboard load. */
export async function integrityCheckAction(_p: ActionState, _fd: FormData): Promise<ActionState> {
  const actor = await getAdminActor();
  if (!actor) return DENIED;
  try {
    const bad = await findBalanceMismatches();
    if (bad.length === 0) return okState("Semua saldo cocok dengan ledger.");
    return {
      ok: false,
      error: `${bad.length} akun saldonya tidak cocok dengan ledger. Periksa segera.`,
      details: bad.slice(0, 10).map((b) => `${b.out_user_id}: saldo ${b.out_saldo} ≠ ledger ${b.out_ledger_sum}`),
    };
  } catch {
    return failState("Pengecekan gagal dijalankan.");
  }
}

const topupRpc = () => createTopupRpc(createAdminClient() as unknown as RpcCaller);

/** Admin checked the bank app and confirms a request by hand (also for late payments). Audited; note required. */
export async function confirmTopupAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getAdminActor();
  if (!actor) return DENIED;
  const adminId = actor.id;
  const parsed = confirmTopupSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const r = await topupRpc().adminConfirmRequest({ adminId, requestId: parsed.data.requestId, note: parsed.data.note });
    if (r.outcome === "NOT_FOUND") return failState("Permintaan tidak ditemukan.");
    if (r.outcome === "CANCELLED") return failState("Permintaan ini dibatalkan user, tidak bisa dikonfirmasi.");
    if (r.outcome === "APPLIED") notify({ severity: "info", title: "Top-up dikonfirmasi manual", lines: [`permintaan ${parsed.data.requestId.slice(0, 8)} oleh ${adminLabel(actor)}`, `catatan: ${parsed.data.note}`] });
    revalidatePath("/admin/topups");
    revalidatePath("/admin");
    return r.outcome === "ALREADY_APPLIED"
      ? okState("Permintaan ini sudah dibayar sebelumnya. Tidak ada saldo yang ditambahkan lagi.")
      : okState(`Dikonfirmasi. Saldo user sekarang ${formatRupiah(r.balanceAfter ?? 0)}.`);
  } catch (e) {
    return failState(describeAdminError(e));
  }
}

/** Queued transfer: credit a chosen user (looked up by exact e-mail) or ignore it. */
export async function resolveTransferAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getAdminActor();
  if (!actor) return DENIED;
  const adminId = actor.id;
  const parsed = resolveTransferSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    let userId: string | null = null;
    if (parsed.data.action === "CREDIT") {
      const { data } = await createAdminClient().from("profiles").select("id").eq("email", parsed.data.userEmail as string).maybeSingle();
      if (!data) return failState("User dengan email itu tidak ditemukan.");
      userId = data.id as string;
    }
    const r = await topupRpc().adminResolveTransfer({ adminId, transferId: parsed.data.transferId, action: parsed.data.action, userId, note: parsed.data.note });
    if (r.outcome === "NOT_FOUND") return failState("Transfer tidak ditemukan.");
    if (r.outcome === "NOT_QUEUED") return failState("Transfer ini sudah diselesaikan sebelumnya.");
    if (r.outcome === "CREDITED") notify({ severity: "warn", title: "Transfer antrian dikreditkan admin", lines: [`oleh ${adminLabel(actor)}`, `catatan: ${parsed.data.note}`] });
    revalidatePath("/admin/topups");
    revalidatePath("/admin");
    return okState(r.outcome === "CREDITED" ? `Dikreditkan. Saldo user sekarang ${formatRupiah(r.balanceAfter ?? 0)}.` : "Transfer diabaikan dan tercatat.");
  } catch (e) {
    return failState(describeAdminError(e));
  }
}

export async function upsertBankAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getAdminActor();
  if (!actor) return DENIED;
  const adminId = actor.id;
  const parsed = bankSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const out = await topupRpc().upsertBank({
      adminId, code: parsed.data.code, bankName: parsed.data.bank_name, accountNumber: parsed.data.account_number,
      accountHolder: parsed.data.account_holder, isActive: parsed.data.is_active, sortOrder: parsed.data.sort_order,
    });
    if (out === "HAS_PENDING_REQUESTS") return failState("Nomor rekening/nama pemilik tidak bisa diubah selama masih ada permintaan top-up yang belum dibayar atau kedaluwarsa. Nonaktifkan bank ini dulu lalu tunggu permintaannya selesai.");
    notify({ severity: "critical", title: "Rekening top-up disimpan", lines: [`${parsed.data.code}, aktif=${parsed.data.is_active}`, `oleh ${adminLabel(actor)}`, "Pastikan nomor rekening benar: ke sinilah uang user dikirim."] });
    revalidateTag(SETTINGS_TAG);
    revalidatePath("/admin/banks");
    return okState(out === "CREATED" ? "Rekening ditambahkan." : "Rekening disimpan.");
  } catch (e) {
    return failState(describeAdminError(e));
  }
}

export async function createInviteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getAdminActor();
  if (!actor) return DENIED;
  const parsed = inviteCreateSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const r = await createInviteRpc(createAdminClient() as unknown as RpcCaller).create({ adminId: actor.id, note: parsed.data.note, validDays: parsed.data.validDays });
    revalidatePath("/admin/invites");
    return okState(`Kode dibuat: ${r.code} (berlaku ${parsed.data.validDays} hari, sekali pakai). Kirim ke calon reseller.`);
  } catch (e) {
    return failState(describeAdminError(e));
  }
}

export async function revokeInviteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getAdminActor();
  if (!actor) return DENIED;
  const parsed = inviteRevokeSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const out = await createInviteRpc(createAdminClient() as unknown as RpcCaller).revoke({ adminId: actor.id, id: parsed.data.id });
    revalidatePath("/admin/invites");
    if (out === "ALREADY_USED") return failState("Kode ini sudah dipakai, tidak bisa dicabut.");
    if (out === "NOT_FOUND") return failState("Kode tidak ditemukan.");
    return okState("Kode dicabut.");
  } catch (e) {
    return failState(describeAdminError(e));
  }
}
