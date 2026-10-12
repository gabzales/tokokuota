"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthFormState } from "@/app/(auth)/actions";
import { inviteCodeError } from "@/lib/invite";
import { emailError, loginPasswordError, nameError, newPasswordError, suggestEmail } from "@/lib/validation";
import { SubmitButton } from "./SubmitButton";
import { linkCls } from "./ui";
import { ValidatedField, ValidatedForm } from "./ValidatedForm";

export function AuthForm(props: {
  mode: "login" | "register";
  action: (prev: AuthFormState, fd: FormData) => Promise<AuthFormState>;
  next?: string;
}) {
  const [state, formAction] = useActionState(props.action, {} as AuthFormState);
  const isLogin = props.mode === "login";

  return (
    <ValidatedForm action={formAction}>
      {props.next ? <input type="hidden" name="next" value={props.next} /> : null}
      {!isLogin && (
        <ValidatedField
          name="inviteCode" label="Kode undangan" placeholder="TK-XXXX-XXXX-XXXX" autoComplete="off" maxLength={24}
          validate={inviteCodeError} hint="Pendaftaran hanya dengan kode dari admin toko. Belum punya? Minta ke admin."
        />
      )}
      {!isLogin && <ValidatedField name="fullName" label="Nama" optional validate={nameError} autoComplete="name" maxLength={60} />}
      <ValidatedField
        name="email" label="Email" type="email" inputMode="email" autoComplete="email" placeholder="nama@email.com"
        validate={emailError} suggest={isLogin ? undefined : suggestEmail}
      />
      <ValidatedField
        name="password" label="Password" type="password" autoComplete={isLogin ? "current-password" : "new-password"} maxLength={72}
        validate={isLogin ? loginPasswordError : newPasswordError} meter={!isLogin} hint={isLogin ? undefined : "Minimal 8 karakter. Makin panjang makin aman."}
      />
      {state.error && <p role="alert" className="animate-fade-up rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.info && <p role="status" className="animate-fade-up rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.info}</p>}
      {isLogin && <p className="text-right text-sm"><Link href="/forgot-password" className={linkCls}>Lupa password?</Link></p>}
      <SubmitButton pendingText={isLogin ? "Masuk…" : "Mendaftar…"}>{isLogin ? "Masuk" : "Daftar"}</SubmitButton>
      {!isLogin && (
        <p className="text-xs text-muted">
          Dengan mendaftar, kamu menyetujui <Link href="/terms" className={linkCls}>Syarat &amp; Ketentuan</Link> dan <Link href="/privacy" className={linkCls}>Kebijakan Privasi</Link>.
        </p>
      )}
      <p className="text-center text-sm text-muted">
        {isLogin ? (
          <>Belum punya akun? <Link href="/register" className={linkCls}>Daftar</Link></>
        ) : (
          <>Sudah punya akun? <Link href="/login" className={linkCls}>Masuk</Link></>
        )}
      </p>
    </ValidatedForm>
  );
}
