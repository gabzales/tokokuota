"use client";

import { useFormStatus } from "react-dom";
import { btnDanger, btnPrimary, btnSecondary } from "./ui";

const STYLES = { primary: btnPrimary, danger: btnDanger, secondary: btnSecondary } as const;

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block animate-[spin_.7s_linear_infinite] rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

export function SubmitButton({ children, pendingText = "Memproses…", variant = "primary", block = true }: {
  children: React.ReactNode; pendingText?: string; variant?: keyof typeof STYLES; block?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} aria-busy={pending} className={`${STYLES[variant]} gap-2 ${block ? "w-full" : ""}`}>
      {pending && <Spinner />}
      {pending ? pendingText : children}
    </button>
  );
}
