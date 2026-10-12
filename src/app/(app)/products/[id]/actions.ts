"use server";

import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/require-user";
import { formatRupiah } from "@/lib/format";
import { checkoutErrorMessage } from "@/lib/transactions/checkout";
import { checkoutInputSchema } from "@/lib/transactions/checkout-input";
import { runCheckout } from "@/lib/transactions/checkout-runtime";
import { LIMITS } from "@/lib/security/rate-limit";
import { checkLimits } from "@/lib/security/rate-limit-server";

export interface CheckoutFormState {
  error?: string;
}

export async function checkoutAction(_prev: CheckoutFormState, formData: FormData): Promise<CheckoutFormState> {
  const user = await getUser(); // verified with Supabase Auth, not just read from the cookie
  if (!user) redirect("/login");

  const parsed = checkoutInputSchema.safeParse({
    productId: formData.get("productId"),
    destination: formData.get("destination"),
    idempotencyKey: formData.get("idempotencyKey"),
    expectedPrice: formData.get("expectedPrice") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? checkoutErrorMessage("INVALID_INPUT") };

  const limited = await checkLimits([{ spec: LIMITS.checkout, id: user.id }]);
  if (limited) return { error: limited };

  let txId: string;
  try {
    const result = await runCheckout({ userId: user.id, ...parsed.data });
    if (!result.ok) {
      if (result.code === "PRICE_CHANGED" && result.currentPrice !== undefined) {
        return { error: `Harga produk berubah menjadi ${formatRupiah(result.currentPrice)}. Muat ulang halaman lalu coba lagi.` };
      }
      return { error: checkoutErrorMessage(result.code) };
    }
    txId = result.txId;
  } catch (e) {
    console.error("checkout failed", e instanceof Error ? e.message : e);
    return { error: "Terjadi gangguan. Cek riwayat transaksi sebelum mencoba lagi." };
  }
  redirect(`/transactions/${txId}`);
}
