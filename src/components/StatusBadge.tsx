const STYLES = {
  PENDING: { label: "Diproses", cls: "bg-amber-100 text-amber-800" },
  SUCCESS: { label: "Berhasil", cls: "bg-emerald-100 text-emerald-800" },
  FAILED: { label: "Gagal", cls: "bg-red-100 text-red-800" },
} as const;

export function StatusBadge({ status }: { status: string }) {
  const s = STYLES[status as keyof typeof STYLES] ?? { label: status, cls: "bg-slate-100 text-slate-700" };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}
