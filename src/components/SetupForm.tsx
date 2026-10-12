"use client";

import type { ActionState } from "@/lib/action-state";
import { ActionForm } from "./ActionForm";
import { SubmitButton } from "./SubmitButton";
import { Field, inputCls } from "./ui";

export function SetupForm({ action }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  return (
    <ActionForm action={action}>
      <Field label="Setup secret" htmlFor="su-secret" hint="Nilai SETUP_SECRET di environment Vercel.">
        <input id="su-secret" name="secret" type="password" required autoComplete="off" maxLength={200} aria-describedby="su-secret-hint" className={inputCls} />
      </Field>
      <Field label="Email admin" htmlFor="su-email">
        <input id="su-email" name="email" type="email" required autoComplete="email" inputMode="email" maxLength={254} placeholder="nama@gmail.com" className={inputCls} />
      </Field>
      <Field label="Password" htmlFor="su-pw" hint="Minimal 8 karakter.">
        <input id="su-pw" name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" aria-describedby="su-pw-hint" className={inputCls} />
      </Field>
      <Field label="Ulangi password" htmlFor="su-pw2">
        <input id="su-pw2" name="confirm" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className={inputCls} />
      </Field>
      <SubmitButton>Buat admin</SubmitButton>
    </ActionForm>
  );
}
