"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/action-state";
import { amountError, digitsOnly, formatThousands } from "@/lib/validation";
import { ActionForm } from "./ActionForm";
import { SubmitButton } from "./SubmitButton";
import { useActionToast } from "./Toast";
import { inputCls } from "./ui";
import { ValidatedField, ValidatedForm } from "./ValidatedForm";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function CreateTopupForm({ action, banks, idempotencyKey, min, max }: {
  action: Action; banks: { code: string; bank_name: string }[]; idempotencyKey: string; min: number; max: number;
}) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  useActionToast(state);
  const [preset, setPreset] = useState<number | undefined>();
  const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
  const presets = [10000, 20000, 50000, 100000, 200000].filter((n) => n >= min && n <= max);
  return (
    <ValidatedForm action={formAction}>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <ValidatedField
        key={preset ?? "free"} name="amount" label="Nominal top-up (Rp)" inputMode="numeric" placeholder="50.000" maxLength={13}
        defaultValue={preset ? String(preset) : ""} parse={digitsOnly} format={formatThousands}
        validate={amountError(min, max)} hint={`Minimal ${rp(min)}, maksimal ${rp(max)}.`}
      />
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Pilihan cepat nominal">
          {presets.map((n) => (
            <button key={n} type="button" onClick={() => setPreset(n)} aria-pressed={preset === n}
              className={`press rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${preset === n ? "border-primary bg-primary text-white" : "border-slate-300 bg-white text-ink hover:border-primary/50"}`}>
              {rp(n)}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor="bank" className="block text-sm font-medium text-ink">Transfer ke bank</label>
        <select id="bank" name="bank" required className={inputCls} defaultValue={banks[0]?.code}>
          {banks.map((b) => <option key={b.code} value={b.code}>{b.bank_name}</option>)}
        </select>
      </div>
      {state.error && <p role="alert" className="animate-fade-up rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <SubmitButton pendingText="Membuat permintaan…">Lanjutkan</SubmitButton>
      <p className="text-xs text-muted">Kamu akan mendapat nominal unik. Transfer persis sebesar itu, dan saldo masuk otomatis sebesar nominal yang kamu transfer.</p>
    </ValidatedForm>
  );
}

export function CancelTopupForm({ action, requestId }: { action: Action; requestId: string }) {
  return (
    <ActionForm action={action} confirm="Batalkan permintaan top-up ini? Jangan transfer jika sudah dibatalkan." className="space-y-2">
      <input type="hidden" name="requestId" value={requestId} />
      <SubmitButton variant="secondary" block={false} pendingText="Membatalkan…">Batalkan permintaan</SubmitButton>
    </ActionForm>
  );
}
