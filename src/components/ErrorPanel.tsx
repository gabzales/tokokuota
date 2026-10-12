"use client";

import { useEffect } from "react";
import { btnPrimary, btnSecondary } from "./ui";

/** Shared body of every error.tsx: friendly text, retry, and no technical detail. */
export function ErrorPanel({ error, reset, backHref, backLabel }: { error: Error & { digest?: string }; reset: () => void; backHref: string; backLabel: string }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
      <p className="text-lg font-semibold text-red-900">Terjadi kesalahan</p>
      <p className="mt-1 text-sm text-red-800">Halaman tidak dapat dimuat. Data kamu aman. Coba lagi dalam beberapa saat.</p>
      {error.digest && <p className="mt-2 text-xs text-red-700">Kode: {error.digest}</p>}
      <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
        <button type="button" onClick={reset} className={btnPrimary}>Coba lagi</button>
        <a href={backHref} className={btnSecondary}>{backLabel}</a>
      </div>
    </div>
  );
}
