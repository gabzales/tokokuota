import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { createServerSupabase } from "@/lib/supabase/server";

// Email-confirmation landing: exchanges the one-time `code` for a session.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${safeNextPath(searchParams.get("next"))}`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
