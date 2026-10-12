import Link from "next/link";
import { LegalLinks } from "@/components/Legal";
import { Logo } from "@/components/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <Link href="/" className="mb-6 flex flex-col items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
        <Logo size={72} />
        <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-2xl font-bold text-transparent">Toko Kuota</span>
        <span className="-mt-1 text-xs font-medium uppercase tracking-widest text-muted">Raja Kuota</span>
      </Link>
      <div className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">{children}</div>
      <LegalLinks className="mt-6" />
    </main>
  );
}
