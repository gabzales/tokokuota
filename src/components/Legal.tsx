import Link from "next/link";
import { Logo } from "./Logo";
import { focusRing, linkCls } from "./ui";

export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Informasi hukum" className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted ${className}`}>
      <Link href="/terms" className={`hover:text-ink ${focusRing} rounded`}>Syarat &amp; Ketentuan</Link>
      <Link href="/privacy" className={`hover:text-ink ${focusRing} rounded`}>Kebijakan Privasi</Link>
    </nav>
  );
}

/** Highlights a value the shop owner must still fill in or confirm. */
export function Todo({ children }: { children: React.ReactNode }) {
  return <mark className="rounded bg-amber-200 px-1 font-medium text-amber-950">[{children}]</mark>;
}

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/" className={`mb-6 flex items-center gap-2 rounded-lg ${focusRing}`}><Logo size={32} /><span className="font-semibold">Toko Kuota</span></Link>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted">Terakhir diperbarui: {updated}</p>
      <p role="note" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <strong>DRAFT, belum ditinjau ahli hukum.</strong> Bagian bertanda <Todo>seperti ini</Todo> harus diisi atau dikonfirmasi pemilik toko sebelum halaman ini dipakai untuk transaksi sungguhan.
      </p>
      <div className="mt-6 space-y-5 text-sm leading-relaxed [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">{children}</div>
      <p className="mt-8 text-sm"><Link href="/" className={linkCls}>← Kembali</Link></p>
      <LegalLinks className="mt-6" />
    </main>
  );
}
