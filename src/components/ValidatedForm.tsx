"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { passwordStrength, type Validator } from "@/lib/validation";
import { inputCls } from "./ui";

interface Ctx { register: (name: string, v: Validator) => () => void; attempt: number }
const FormCtx = createContext<Ctx | null>(null);

/**
 * <form> with instant inline validation. On submit every field is checked; if something is wrong the
 * submit is cancelled, the form shakes, and focus jumps to the first wrong field. The server still
 * re-validates everything, so this is purely about speed and clarity for the user.
 * Pass `action` (server action) or `onValidSubmit` (client-only forms such as the landing simulator).
 */
export function ValidatedForm({ action, onValidSubmit, children, className = "space-y-4", confirmMessage }: {
  action?: (fd: FormData) => void | Promise<void>;
  onValidSubmit?: (fd: FormData) => void;
  children: React.ReactNode;
  className?: string;
  confirmMessage?: string;
}) {
  const validators = useRef(new Map<string, Validator>());
  const [attempt, setAttempt] = useState(0);
  const [shake, setShake] = useState(false);
  const register = useCallback((name: string, v: Validator) => {
    validators.current.set(name, v);
    return () => { validators.current.delete(name); };
  }, []);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const data = new FormData(form);
    let first: string | null = null;
    for (const [name, validate] of validators.current) {
      if (validate(String(data.get(name) ?? "")) && first === null) first = name;
    }
    setAttempt((n) => n + 1); // every field now shows its own message
    if (first !== null) {
      e.preventDefault();
      setShake(true);
      window.setTimeout(() => setShake(false), 480);
      form.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    if (confirmMessage && !window.confirm(confirmMessage)) { e.preventDefault(); return; }
    if (onValidSubmit) { e.preventDefault(); onValidSubmit(data); }
  }

  return (
    <FormCtx.Provider value={{ register, attempt }}>
      <form noValidate action={action} onSubmit={onSubmit} className={`${className} ${shake ? "animate-shake" : ""}`}>{children}</form>
    </FormCtx.Provider>
  );
}

const EyeIcon = ({ off }: { off: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{off && <path d="m3 3 18 18" />}
  </svg>
);

export function ValidatedField(props: {
  name: string;
  label: string;
  validate: Validator;
  type?: "text" | "email" | "password" | "tel";
  hint?: string;
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "tel" | "email" | "decimal";
  placeholder?: string;
  maxLength?: number;
  defaultValue?: string;
  /** Show the value formatted (e.g. "50.000") while the form submits the raw value from `parse`. */
  format?: (raw: string) => string;
  parse?: (display: string) => string;
  /** Offer a corrected value (e-mail typo). */
  suggest?: (raw: string) => string | null;
  /** Show a password strength bar. */
  meter?: boolean;
  optional?: boolean;
  /** Reported on every change (e.g. to compare "confirm password"). */
  onValue?: (raw: string) => void;
}) {
  const ctx = useContext(FormCtx);
  const id = useId();
  const [display, setDisplay] = useState(props.defaultValue ?? "");
  const [touched, setTouched] = useState(false);
  const [reveal, setReveal] = useState(false);
  const latest = useRef(props.validate);
  latest.current = props.validate;
  const register = ctx?.register;
  useEffect(() => register?.(props.name, (v) => latest.current(v)), [register, props.name]);

  const raw = props.parse ? props.parse(display) : display;
  const showErrors = touched || (ctx?.attempt ?? 0) > 0;
  const error = showErrors ? props.validate(raw) : null;
  const valid = touched && !error && raw.trim() !== "";
  const suggestion = props.suggest && touched && !error ? props.suggest(raw) : null;
  const strength = props.meter ? passwordStrength(raw) : null;
  const isPassword = props.type === "password";
  const describedBy = [props.hint ? `${id}-hint` : null, `${id}-err`, strength?.label ? `${id}-meter` : null].filter(Boolean).join(" ");

  const stateCls = error
    ? "!border-red-400 focus-visible:!ring-red-300"
    : valid ? "!border-emerald-400" : "";

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-baseline justify-between text-sm font-medium text-ink">
        <span>{props.label}</span>
        {props.optional && <span className="text-xs font-normal text-muted">opsional</span>}
      </label>
      <div className="relative">
        {props.parse && <input type="hidden" name={props.name} value={raw} />}
        <input
          id={id}
          data-field={props.name}
          name={props.parse ? undefined : props.name}
          type={isPassword && reveal ? "text" : props.type ?? "text"}
          value={props.format ? props.format(raw) : display}
          onChange={(e) => {
            const next = e.target.value;
            setDisplay(props.parse ? next : next);
            props.onValue?.(props.parse ? props.parse(next) : next);
          }}
          onBlur={() => setTouched(true)}
          autoComplete={props.autoComplete}
          inputMode={props.inputMode}
          placeholder={props.placeholder}
          maxLength={props.maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${inputCls} ${isPassword || valid ? "pr-11" : ""} ${stateCls} transition-colors`}
        />
        {isPassword ? (
          <button type="button" onClick={() => setReveal((r) => !r)} aria-pressed={reveal} aria-label={reveal ? "Sembunyikan password" : "Tampilkan password"}
            className="press absolute inset-y-0 right-1 my-auto flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
            <EyeIcon off={reveal} />
          </button>
        ) : valid ? (
          <span aria-hidden="true" className="animate-pop pointer-events-none absolute inset-y-0 right-3 flex items-center text-emerald-600">✓</span>
        ) : null}
      </div>
      {strength && strength.score > 0 && (
        <div id={`${id}-meter`} className="flex items-center gap-2" aria-live="polite">
          <div className="flex flex-1 gap-1" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i <= strength.score ? (strength.score <= 1 ? "bg-red-400" : strength.score === 2 ? "bg-amber-400" : "bg-emerald-500") : "bg-slate-200"}`} />
            ))}
          </div>
          <span className="w-24 text-right text-xs text-muted">{strength.label}</span>
        </div>
      )}
      {props.hint && !error && <p id={`${id}-hint`} className="text-xs text-muted">{props.hint}</p>}
      <div id={`${id}-err`} aria-live="polite">
        {error && <p className="animate-fade-up text-xs text-red-700">{error}</p>}
      </div>
      {suggestion && (
        <p className="animate-fade-up text-xs text-muted">
          Maksud kamu{" "}
          <button type="button" onClick={() => { setDisplay(suggestion); props.onValue?.(suggestion); }} className="press rounded font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">{suggestion}</button>?
        </p>
      )}
    </div>
  );
}
