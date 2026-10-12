"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ActionState } from "@/lib/action-state";

type Kind = "success" | "error" | "info";
interface Toast { id: number; kind: Kind; message: string }
const Ctx = createContext<{ push: (kind: Kind, message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((kind: Kind, message: string) => {
    const id = ++seq.current;
    setItems((cur) => [...cur.slice(-3), { id, kind, message }]);
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), kind === "error" ? 8000 : 5000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* aria-live so screen readers announce results of form submissions */}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6">
        {items.map((t) => (
          <div
            key={t.id}
            className={`animate-toast-in pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ring-1 ${
              t.kind === "success" ? "bg-emerald-600 text-white ring-emerald-700"
              : t.kind === "error" ? "bg-red-600 text-white ring-red-700"
              : "bg-slate-800 text-white ring-slate-900"
            }`}
          >
            <span aria-hidden="true">{t.kind === "success" ? "✓" : t.kind === "error" ? "!" : "i"}</span>
            <span className="flex-1">{t.message}</span>
            <button type="button" aria-label="Tutup notifikasi" onClick={() => setItems((cur) => cur.filter((x) => x.id !== t.id))} className="opacity-80 hover:opacity-100">×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used inside <ToastProvider>");
  return c;
}

/** Shows a toast whenever a server action returns a new result. */
export function useActionToast(state: ActionState) {
  const { push } = useToast();
  useEffect(() => {
    if (state.error) push("error", state.error);
    else if (state.message) push("success", state.message);
  }, [state, push]);
}
