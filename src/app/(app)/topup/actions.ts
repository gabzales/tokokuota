"use server";

import { redirect } from "next/navigation";
import { failState, type ActionState } from "@/lib/action-state";
import { getUser } from "@/lib/auth/require-user";
import { getTopupSettings } from "@/lib/settings/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTopupMessage } from "@/lib/topup/messages";
import { createTopupRpc } from "@/lib/topup/rpc";
import { cancelTopupSchema, createTopupSchema } from "@/lib/topup/schemas";
import { LIMITS } from "@/lib/security/rate-limit";
import { checkLimits } from "@/lib/security/rate-limit-server";
import type { RpcCaller } from "@/lib/transactions/rpc";

const rpc = () => createTopupRpc(createAdminClient() as unknown as RpcCaller);

export async function createTopupAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getUser(); // verified with Supabase Auth
  if (!user) redirect("/login");

  const parsed = createTopupSchema.safeParse({ bank: fd.get("bank"), amount: fd.get("amount"), idempotencyKey: fd.get("idempotencyKey") });
  if (!parsed.success) return failState(parsed.error.issues[0]?.message ?? "Data tidak valid.");

  const limited = await checkLimits([{ spec: LIMITS.topupCreate, id: user.id }]);
  if (limited) return failState(limited);

  let requestId: string;
  try {
    const r = await rpc().createRequest({ userId: user.id, bankCode: parsed.data.bank, baseAmount: parsed.data.amount, idempotencyKey: parsed.data.idempotencyKey });
    if (r.outcome !== "CREATED" && r.outcome !== "EXISTING") {
      const s = await getTopupSettings();
      return failState(createTopupMessage(r.outcome, { min: s.min, max: s.max }));
    }
    if (!r.requestId) throw new Error("create_topup_request returned no id");
    requestId = r.requestId;
  } catch (e) {
    console.error("create topup failed", e instanceof Error ? e.message : e);
    return failState("Terjadi gangguan. Coba lagi dalam beberapa saat.");
  }
  redirect(`/topup/${requestId}`);
}

export async function cancelTopupAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) redirect("/login");
  const parsed = cancelTopupSchema.safeParse({ requestId: fd.get("requestId") });
  if (!parsed.success) return failState("Data tidak valid.");

  try {
    const out = await rpc().cancelRequest({ userId: user.id, requestId: parsed.data.requestId });
    if (out === "NOT_PENDING") return failState("Permintaan ini sudah tidak bisa dibatalkan.");
    if (out === "NOT_FOUND") return failState("Permintaan tidak ditemukan.");
  } catch {
    return failState("Terjadi gangguan. Coba lagi.");
  }
  redirect("/topup");
}
