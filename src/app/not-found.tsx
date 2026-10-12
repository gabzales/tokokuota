import Link from "next/link";
import { Logo } from "@/components/Logo";
import { btnPrimary } from "@/components/ui";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo size={64} />
      <h1 className="text-xl font-semibold">Halaman tidak ditemukan</h1>
      <p className="text-sm text-muted">Alamat yang kamu buka tidak ada atau sudah dipindahkan.</p>
      <Link href="/" className={btnPrimary}>Ke beranda</Link>
    </main>
  );
}
