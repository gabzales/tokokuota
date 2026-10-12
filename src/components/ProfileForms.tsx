"use client";

import { useActionState, useRef } from "react";
import type { ActionState } from "@/lib/action-state";
import { confirmPasswordError, loginPasswordError, nameError, newPasswordError } from "@/lib/validation";
import { SubmitButton } from "./SubmitButton";
import { useActionToast } from "./Toast";
import { ValidatedField, ValidatedForm } from "./ValidatedForm";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const Fb = ({ s }: { s: ActionState }) => (
  <div aria-live="polite">
    {s.error && <p role="alert" className="animate-fade-up rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{s.error}</p>}
    {s.message && !s.error && <p className="animate-fade-up rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{s.message}</p>}
  </div>
);

export function NameForm({ action, defaultName }: { action: Action; defaultName: string }) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  useActionToast(state);
  return (
    <ValidatedForm action={formAction}>
      <ValidatedField name="fullName" label="Nama" optional defaultValue={defaultName} validate={nameError} autoComplete="name" maxLength={60} />
      <Fb s={state} />
      <SubmitButton block={false} pendingText="Menyimpan…">Simpan nama</SubmitButton>
    </ValidatedForm>
  );
}

export function PasswordForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  useActionToast(state);
  const cur = useRef("");
  const next = useRef("");
  return (
    <ValidatedForm action={formAction}>
      <ValidatedField name="current" label="Password saat ini" type="password" autoComplete="current-password" maxLength={72} validate={loginPasswordError} onValue={(v) => { cur.current = v; }} />
      <ValidatedField name="password" label="Password baru" type="password" autoComplete="new-password" maxLength={72} meter
        validate={(v) => newPasswordError(v) ?? (v === cur.current ? "Password baru harus berbeda dari yang lama" : null)} onValue={(v) => { next.current = v; }} hint="8–72 karakter." />
      <ValidatedField name="confirm" label="Ulangi password baru" type="password" autoComplete="new-password" maxLength={72} validate={confirmPasswordError(() => next.current)} />
      <Fb s={state} />
      <SubmitButton block={false} pendingText="Menyimpan…">Ganti password</SubmitButton>
      <p className="text-xs text-muted">Setelah diganti, perangkat lain yang sedang masuk akan keluar otomatis.</p>
    </ValidatedForm>
  );
}
