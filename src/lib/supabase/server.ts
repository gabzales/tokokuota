import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Per-request client bound to the signed-in user's cookies (anon key + RLS).
 * Use it for READS of the user's own data. Writes that touch money go through the
 * service-role RPCs in lib/supabase/admin.ts after the user has been verified.
 */
export async function createServerSupabase() {
  // Read cookies FIRST: that marks the page as request-time (dynamic) so `next build` never tries
  // to prerender a signed-in page, and only then complain about missing configuration.
  const store = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there. The middleware refreshes the session.
        }
      },
    },
  });
}
