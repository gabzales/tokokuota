"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server component every `everyMs` (default 15s) for at most `maxMs` (default 5 min). */
export function AutoRefresh({ everyMs = 15_000, maxMs = 300_000 }: { everyMs?: number; maxMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - started > maxMs) return clearInterval(t);
      router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs, maxMs]);
  return null;
}
