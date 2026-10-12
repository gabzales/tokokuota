"use client";

import { useActionState } from "react";
import type { CheckoutFormState } from "@/app/(app)/products/[id]/actions";
import { destinationError } from "@/lib/validation";
import { SubmitButton } from "./SubmitButton";
import { useActionToast } from "./Toast";
import { ValidatedField, ValidatedForm } from "./ValidatedForm";

export function CheckoutForm(props: {
  action: (prev: CheckoutFormState, fd: FormData) => Promise<CheckoutFormState>;
  productId: string;
  idempotencyKey: string;
  expectedPrice: number;
  priceLabel: string;
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState(props.action, {} as CheckoutFormState);
  useActionToast({ error: state.error });
  return (
    <ValidatedForm action={formAction}>
      <input type="hidden" name="productId" value={props.productId} />
      <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
      <input type="hidden" name="expectedPrice" value={props.expectedPrice} />
      <ValidatedField
        name="destination" label="Nomor / ID tujuan" inputMode="tel" autoComplete="off" placeholder="08xxxxxxxxxx" maxLength={64}
        validate={destinationError} hint="Hanya huruf, angka, dan tanda . _ - @ :"
      />
      {state.error && <p role="alert" className="animate-fade-up rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {props.disabled ? (
        <p className="text-sm text-red-600">Produk sedang tidak tersedia.</p>
      ) : (
        <SubmitButton pendingText="Memproses pesanan…">Beli {props.priceLabel}</SubmitButton>
      )}
      <p className="text-xs text-muted">Saldo dipotong saat pesanan dibuat. Jika transaksi gagal, saldo dikembalikan otomatis.</p>
    </ValidatedForm>
  );
}
