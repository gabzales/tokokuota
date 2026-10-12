import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { SETTINGS_TAG, toPublicSettings, toSyncOptions, toTopupSettings } from "./keys";

async function readAll() {
  const { data, error } = await createAdminClient().from("app_settings").select("key,value");
  if (error) throw new Error(`settings read failed: ${error.message}`);
  return (data ?? []) as { key: string; value: unknown }[];
}

/** Public subset (maintenance flag, announcement, support contact): one cached read per minute. */
export const getPublicSettings = unstable_cache(async () => toPublicSettings(await readAll()), ["public-settings-v1"], {
  revalidate: 60,
  tags: [SETTINGS_TAG],
});

/** Uncached, for the admin settings page and the catalogue sync. */
export async function getSyncOptions() {
  return toSyncOptions(await readAll());
}
export async function getAllSettingRows() {
  return readAll();
}

/** Top-up limits/flag for the user form (cached 60 s; the database re-checks every value on create). */
export const getTopupSettings = unstable_cache(async () => toTopupSettings(await readAll()), ["topup-settings-v1"], {
  revalidate: 60,
  tags: [SETTINGS_TAG],
});
