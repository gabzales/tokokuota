"use client";

import { useState } from "react";
import { focusRing } from "./ui";
import { useToast } from "./Toast";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const { push } = useToast();
  return (
    <button
      type="button"
      aria-label={`Salin ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          push("success", `${label} disalin`);
          setTimeout(() => setDone(false), 2000);
        } catch {
          push("error", "Tidak bisa menyalin otomatis. Salin manual ya.");
        }
      }}
      className={`min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-ink hover:bg-slate-50 ${focusRing}`}
    >
      {done ? "Tersalin ✓" : "Salin"}
    </button>
  );
}
