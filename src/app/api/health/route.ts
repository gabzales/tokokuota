import { NextResponse } from "next/server";

// Liveness only: deliberately touches no database and no provider.
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({ ok: true });
}
