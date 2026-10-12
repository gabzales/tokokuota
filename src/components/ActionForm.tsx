"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { useActionToast } from "./Toast";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Form bound to a server action: shows the result inline (aria-live) and as a toast.
 * `children` may be a function to read the latest state (e.g. to reset fields).
 */
export function ActionForm({ action, children, className = "space-y-4", confirm }: {
  action: Action;
  children: React.ReactNode | ((state: ActionState, pending: boolean) => React.ReactNode);
  className?: string;
  /** Native confirm() before submitting (destructive / wide-impact actions). */
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  useActionToast(state);
  return (
    <form action={formAction} className={className} onSubmit={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined} aria-busy={pending}>
      {typeof children === "function" ? children(state, pending) : children}
      <div aria-live="polite">
        {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
        {state.details && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-700">{state.details.map((d) => <li key={d} className="break-all">{d}</li>)}</ul>}
        {state.message && !state.error && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>}
      </div>
    </form>
  );
}
