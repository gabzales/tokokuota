"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Time left to pay. When it reaches zero the page refreshes once so the status updates. */
export function Countdown({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();
  const end = new Date(expiresAt).getTime();
  const [left, setLeft] = useState(() => end - Date.now());
  useEffect(() => {
    const t = setInterval(() => setLeft(end - Date.now()), 1000);
    return () => clearInterval(t);
  }, [end]);
  useEffect(() => { if (left <= 0) router.refresh(); }, [left <= 0, router]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span className="font-mono tabular-nums" aria-label="Sisa waktu pembayaran">{fmt(left)}</span>;
}
