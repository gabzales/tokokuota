import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { SETTINGS_TAG } from "@/lib/settings/keys";

/** Bank choices for the form: code + name only (account details are shown on a request's own page). */
export const getActiveBankChoices = unstable_cache(
  async () => {
    const { data, error } = await createAdminClient().from("topup_banks").select("code,bank_name").eq("is_active", true).order("sort_order").order("code");
    if (error) throw new Error(`banks read failed: ${error.message}`);
    return (data ?? []) as { code: string; bank_name: string }[];
  },
  ["topup-bank-choices-v1"],
  { revalidate: 60, tags: [SETTINGS_TAG] },
);

/** Account details for ONE request's bank. Call only after the request was read through the user's RLS client. */
export async function getBankAccount(code: string) {
  const { data, error } = await createAdminClient().from("topup_banks").select("bank_name,account_number,account_holder").eq("code", code).maybeSingle();
  if (error) throw new Error(`bank read failed: ${error.message}`);
  return data as { bank_name: string; account_number: string; account_holder: string } | null;
}
