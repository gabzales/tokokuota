"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import type { EnrollState } from "@/app/mfa/actions";
import { CopyButton } from "./CopyButton";
import { SubmitButton } from "./SubmitButton";
import { useActionToast } from "./Toast";
import { ValidatedField, ValidatedForm } from "./ValidatedForm";

const codeError = (v: string) => (/^\d{6}$/.test(v.trim()) ? null : "Masukkan 6 angka dari aplikasi authenticator");

export function MfaVerifyForm({ action, factorId, next }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; factorId: string; next: string }) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  useActionToast(state);
  return (
    <ValidatedForm action={formAction}>
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />
      <ValidatedField name="code" label="Kode 6 angka" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" validate={codeError} />
      {state.error && <p role="alert" className="animate-fade-up rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <SubmitButton pendingText="Memverifikasi…">Verifikasi</SubmitButton>
    </ValidatedForm>
  );
}

export function MfaEnroll({ startAction, verifyAction, next }: {
  startAction: (p: EnrollState, fd: FormData) => Promise<EnrollState>;
  verifyAction: (p: ActionState, fd: FormData) => Promise<ActionState>;
  next: string;
}) {
  const [enroll, start] = useActionState(startAction, {} as EnrollState);
  if (enroll.ok && enroll.factorId && enroll.qr && enroll.secret) {
    return (
      <div className="space-y-4 animate-fade-up">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Buka aplikasi authenticator (Google Authenticator, Authy, 1Password, dll).</li>
          <li>Pindai kode QR ini, atau masukkan kunci manual di bawahnya.</li>
          <li>Masukkan kode 6 angka yang muncul.</li>
        </ol>
        {/* data: URI from Supabase (an inline SVG); allowed by the CSP img-src */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={enroll.qr} alt="Kode QR untuk aplikasi authenticator" width={180} height={180} className="mx-auto rounded-xl border border-slate-200 bg-white p-2" />
        <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
          <span className="break-all font-mono">{enroll.secret}</span>
          <CopyButton value={enroll.secret} label="kunci" />
        </div>
        <MfaVerifyForm action={verifyAction} factorId={enroll.factorId} next={next} />
      </div>
    );
  }
  return (
    <form action={start} className="space-y-3">
      {enroll.error && <p role="alert" className="animate-fade-up rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{enroll.error}</p>}
      <SubmitButton pendingText="Menyiapkan…">Mulai pasang authenticator</SubmitButton>
    </form>
  );
}
