import "server-only";
import { z } from "zod";

// Two independent groups, so the app runs without provider credentials:
//  - Supabase: needed by almost every page and action
//  - Provider (KhfyPay): needed only when something is actually SENT to / read from the provider
// Nothing here is cached and no value ever appears in an error message (only variable names).

const supabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

const providerSchema = z.object({
  KHFYPAY_BASE_URL: z.string().url(),
  KHFYPAY_API_KEY: z.string().min(1),
  KHFYPAY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
});

function parse<S extends z.ZodTypeAny>(schema: S, label: string): z.infer<S> {
  const r = schema.safeParse(process.env);
  if (!r.success) {
    const names = [...new Set(r.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Invalid/missing environment variables (${label}): ${names}`);
  }
  return r.data;
}

export const supabaseEnv = () => parse(supabaseSchema, "supabase");
export const providerEnv = () => parse(providerSchema, "provider");

function requireSecret(name: string, minLen: number): string {
  const v = process.env[name];
  if (!v || v.length < minLen) {
    throw new Error(`${name} is not set (min ${minLen} chars)`);
  }
  return v;
}

/** Shared secret that must be present in the webhook URL we register with the provider. */
export const webhookSecret = () => requireSecret("WEBHOOK_SECRET", 24);
/** Optional. Enables the one-time /setup page that creates the first admin. Unset => /setup is a 404. */
export const setupSecret = (): string | null => {
  const v = process.env.SETUP_SECRET;
  return v && v.length >= 24 ? v : null;
};
/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export const cronSecret = () => requireSecret("CRON_SECRET", 16);
