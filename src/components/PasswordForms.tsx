"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import type { ActionState } from "@/lib/action-state";
import { confirmPasswordError, emailError, newPasswordError } from "@/lib/validation";
import { SubmitButton } from "./SubmitButton";
import { useActionToast } from "./Toast";
import { linkCls } from "./ui";
import { ValidatedField, ValidatedForm } from "./ValidatedForm";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

function Feedback({ state }: { state: ActionState }) {
  return (
    <div aria-live="polite">
      {state.error && <p role="alert" className="animate-fade-up rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.message && !state.error && <p className="animate-fade-up rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>}
    </div>
  );
}

export function ForgotPasswordForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  useActionToast(state);
  return (
    <ValidatedForm action={formAction}>
      <ValidatedField name="email" label="Email" type="email" inputMode="email" autoComplete="email" validate={emailError} hint="Kami kirim tautan untuk mengatur ulang password." placeholder="nama@email.com" />
      <Feedback state={state} />
      <SubmitButton pendingText="Mengirim…">Kirim tautan</SubmitButton>
      <p className="text-center text-sm text-muted"><Link href="/login" className={linkCls}>Kembali ke halaman masuk</Link></p>
    </ValidatedForm>
  );
}

export function ResetPasswordForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  useActionToast(state);
  const pw = useRef("");
  return (
    <ValidatedForm action={formAction}>
      <ValidatedField name="password" label="Password baru" type="password" autoComplete="new-password" maxLength={72} meter validate={newPasswordError} onValue={(v) => { pw.current = v; }} hint="8–72 karakter." />
      <ValidatedField name="confirm" label="Ulangi password baru" type="password" autoComplete="new-password" maxLength={72} validate={confirmPasswordError(() => pw.current)} />
      <Feedback state={state} />
      <SubmitButton pendingText="Menyimpan…">Simpan password</SubmitButton>
      <p className="text-xs text-muted">Setelah password diganti, perangkat lain yang sedang masuk akan keluar otomatis.</p>
    </ValidatedForm>
  );
}
