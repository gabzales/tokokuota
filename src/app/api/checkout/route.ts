import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/require-user";
import { isSameOrigin } from "@/lib/security/origin";
import { checkoutHttpStatus } from "@/lib/transactions/checkout";
import { checkoutInputSchema } from "@/lib/transactions/checkout-input";
import { runCheckout } from "@/lib/transactions/checkout-runtime";
import { LIMITS } from "@/lib/security/rate-limit";
import { checkLimits } from "@/lib/security/rate-limit-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 2048;
const err = (status: number, error: string, extra?: object) => NextResponse.json({ ok: false, error, ...extra }, { status });

/**
 * JSON checkout for non-form clients. The user comes from the verified session, never from the
 * body. The body cannot carry a price to charge: `expectedPrice` is only a stale-catalogue guard.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return err(403, "forbidden");
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return err(415, "expected application/json");

  const user = await getUser();
  if (!user) return err(401, "unauthorized");

  const limited = await checkLimits([{ spec: LIMITS.checkout, id: user.id }]);
  if (limited) return err(429, "rate_limited", { message: limited });

  const text = await req.text();
  if (text.length > MAX_BODY) return err(413, "payload too large");
  let body: unknown;
  try { body = JSON.parse(text); } catch { return err(400, "invalid json"); }

  const parsed = checkoutInputSchema.safeParse(body);
  if (!parsed.success) return err(422, parsed.error.issues[0]?.message ?? "invalid input");

  try {
    const result = await runCheckout({ userId: user.id, ...parsed.data });
    if (!result.ok) return err(checkoutHttpStatus(result.code), result.code, result.currentPrice !== undefined ? { currentPrice: result.currentPrice } : undefined);
    return NextResponse.json({ ok: true, transactionId: result.txId, status: result.status, created: result.created }, { status: result.created ? 201 : 200 });
  } catch (e) {
    console.error("checkout failed", e instanceof Error ? e.message : e);
    return err(500, "temporary error");
  }
}
