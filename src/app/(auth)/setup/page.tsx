import { notFound } from "next/navigation";
import { SetupForm } from "@/components/SetupForm";
import { setupSecret } from "@/lib/env/server";
import { createSetupRpc } from "@/lib/setup";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RpcCaller } from "@/lib/transactions/rpc";
import { setupAdminAction } from "./actions";

export const metadata = { title: "Setup admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  // 404 unless the owner switched it on (SETUP_SECRET) AND no admin exists yet: afterwards the page simply vanishes.
  if (!setupSecret()) notFound();
  let needed = false;
  try {
    needed = await createSetupRpc(createAdminClient() as unknown as RpcCaller).isNeeded();
  } catch {
    notFound();
  }
  if (!needed) notFound();

  return (
    <>
      <h2 className="mb-1 text-lg font-semibold">Setup admin pertama</h2>
      <p className="mb-4 text-sm text-muted">Sekali pakai. Setelah admin dibuat, halaman ini hilang sendiri.</p>
      <SetupForm action={setupAdminAction} />
    </>
  );
}
