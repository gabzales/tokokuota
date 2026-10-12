"use server";

import { redirect } from "next/navigation";
import { failState, type ActionState } from "@/lib/action-state";
import { setupSecret } from "@/lib/env/server";
import { createSetupRpc, setupSchema } from "@/lib/setup";
import { LIMITS } from "@/lib/security/rate-limit";
import { checkLimits, currentIp } from "@/lib/security/rate-limit-server";
import { safeEqual } from "@/lib/security/timing";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RpcCaller } from "@/lib/transactions/rpc";

const DONE = "Setup sudah selesai atau tidak tersedia.";

/**
 * One-time creation of the FIRST admin. Three locks: (1) SETUP_SECRET must be configured and typed correctly,
 * (2) the database must have no admin yet (advisory-locked, so parallel attempts cannot make two), (3) the account
 * goes through the same invite gate as everybody else (a 10-minute single-use code minted here).
 * The secret is typed in the form (never in the URL, so it cannot end up in access logs).
 */
export async function setupAdminAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const expected = setupSecret();
  if (!expected) return failState(DONE);

  const parsed = setupSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return failState(parsed.error.issues[0]?.message ?? "Input tidak valid.");

  const limited = await checkLimits([{ spec: LIMITS.setupIp, id: await currentIp() }]);
  if (limited) return failState(limited);

  if (!safeEqual(parsed.data.secret, expected)) return failState("Secret salah.");

  const admin = createAdminClient();
  const rpc = createSetupRpc(admin as unknown as RpcCaller);
  try {
    const invite = await rpc.issueInvite();
    if (!invite) return failState(DONE);

    const { data, error } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true, // the person holding SETUP_SECRET is the owner; no confirmation e-mail needed
      user_metadata: { invite_code: invite },
    });
    if (error || !data.user) {
      console.error("setup createUser failed:", error?.message);
      return failState("Akun tidak bisa dibuat. Email mungkin sudah terdaftar, atau Supabase bermasalah.");
    }

    if (!(await rpc.promote(data.user.id))) {
      // lost a race with another setup: do not leave a stray account behind
      await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      return failState(DONE);
    }
  } catch (e) {
    console.error("setup failed:", e instanceof Error ? e.message : e);
    return failState("Setup gagal. Pastikan migrasi 0001–0008 sudah dijalankan dan env Supabase benar.");
  }
  redirect("/login");
}
