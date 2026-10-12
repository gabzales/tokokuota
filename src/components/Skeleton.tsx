export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Memuat" className="animate-pulse space-y-4">
      <div className="h-7 w-48 rounded-lg bg-slate-200" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-slate-200" />)}
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }, (_, i) => <div key={i} className="h-14 rounded-xl bg-slate-200/80" />)}
      </div>
      <span className="sr-only">Memuat…</span>
    </div>
  );
}
