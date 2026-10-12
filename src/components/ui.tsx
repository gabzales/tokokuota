import Link from "next/link";

// Shared design tokens as class strings: keeps every screen (user + admin) visually consistent.
export const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2";
export const inputCls = `w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 disabled:bg-slate-50 ${focusRing}`;
export const btnPrimary = `press inline-flex min-h-11 items-center justify-center rounded-lg bg-gradient-to-r from-primary to-secondary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;
export const btnSecondary = `press inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;
export const btnDanger = `press inline-flex min-h-11 items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;
export const linkCls = `text-primary underline-offset-2 hover:underline ${focusRing} rounded`;

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm sm:p-6 ${className}`}>{children}</section>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = "default", href }: { label: string; value: React.ReactNode; hint?: string; tone?: "default" | "warn" | "danger" | "brand"; href?: string }) {
  const tones = {
    default: "border-slate-200 bg-surface text-ink",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-900",
    brand: "border-transparent bg-gradient-to-br from-primary to-secondary text-white",
  } as const;
  const body = (
    <div className={`h-full rounded-2xl border p-4 ${tones[tone]}`}>
      <p className={`text-xs font-medium uppercase tracking-wide ${tone === "brand" ? "text-white/80" : "text-muted"}`}>{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className={`mt-1 text-xs ${tone === "brand" ? "text-white/80" : "text-muted"}`}>{hint}</p>}
    </div>
  );
  return href ? <Link href={href} className={`block rounded-2xl ${focusRing}`}>{body}</Link> : body;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <div aria-hidden="true" className="mx-auto mb-3 h-10 w-10 rounded-full bg-gradient-to-br from-primary/15 to-secondary/15" />
      <p className="font-medium text-ink">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const BADGES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800", SUCCESS: "bg-emerald-100 text-emerald-800", FAILED: "bg-red-100 text-red-800",
  PURCHASE: "bg-slate-100 text-slate-700", REFUND: "bg-sky-100 text-sky-800", MANUAL_TOPUP: "bg-emerald-100 text-emerald-800", ADJUSTMENT: "bg-purple-100 text-purple-800",
  ADMIN: "bg-purple-100 text-purple-800", USER: "bg-slate-100 text-slate-700", ACTIVE: "bg-emerald-100 text-emerald-800", INACTIVE: "bg-red-100 text-red-800",
  REVIEW: "bg-red-100 text-red-800", WARN: "bg-amber-100 text-amber-800",
  PAID: "bg-emerald-100 text-emerald-800", EXPIRED: "bg-slate-200 text-slate-700", USED: "bg-sky-100 text-sky-800", REVOKED: "bg-slate-200 text-slate-700", CANCELLED: "bg-slate-200 text-slate-700",
  QUEUED: "bg-amber-100 text-amber-800", CREDITED: "bg-emerald-100 text-emerald-800", RESOLVED: "bg-sky-100 text-sky-800", IGNORED: "bg-slate-200 text-slate-700",
};
export function Badge({ children, kind }: { children: React.ReactNode; kind: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGES[kind] ?? "bg-slate-100 text-slate-700"}`}>{children}</span>;
}

export function Pagination({ page, hasNext, hrefFor }: { page: number; hasNext: boolean; hrefFor: (page: number) => string }) {
  if (page <= 1 && !hasNext) return null;
  return (
    <nav aria-label="Halaman" className="mt-4 flex items-center justify-between text-sm">
      {page > 1 ? <Link className={linkCls} href={hrefFor(page - 1)}>← Sebelumnya</Link> : <span />}
      <span className="text-muted">Halaman {page}</span>
      {hasNext ? <Link className={linkCls} href={hrefFor(page + 1)}>Berikutnya →</Link> : <span />}
    </nav>
  );
}

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">{label}</label>
      {children}
      {hint && <p id={`${htmlFor}-hint`} className="text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** Table that scrolls inside its own container on small screens (the page never scrolls sideways). */
export function TableWrap({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-surface">
      <table aria-label={label} className="min-w-full divide-y divide-slate-100 text-sm">{children}</table>
    </div>
  );
}
export const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted whitespace-nowrap";
export const td = "px-3 py-2.5 align-top";

export function FilterForm({ children, action }: { children: React.ReactNode; action: string }) {
  return (
    <form action={action} method="get" role="search" className="mb-4 flex flex-wrap items-end gap-2">
      {children}
    </form>
  );
}
