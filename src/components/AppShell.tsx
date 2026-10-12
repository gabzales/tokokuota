import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { getProfile, requireUser } from "@/lib/auth/require-user";
import { formatRupiah } from "@/lib/format";
import { LegalLinks } from "./Legal";
import { Brand } from "./Logo";
import { BottomNav, NavLinks, type NavItem } from "./NavLinks";
import { SiteBanner } from "./SiteBanner";
import { focusRing } from "./ui";

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "⌂" },
  { href: "/products", label: "Produk", icon: "▦" },
  { href: "/topup", label: "Top-up", icon: "＋" },
  { href: "/transactions", label: "Riwayat", icon: "☰" },
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  await requireUser();
  const profile = await getProfile();
  const isAdmin = profile?.role === "admin" && profile.is_active;

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-surface/95 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <Link href="/dashboard" aria-label="Toko Kuota — ke dashboard" className={`rounded-lg ${focusRing}`}><Brand compact /></Link>
          <div className="ml-2 hidden md:block"><NavLinks items={NAV} /></div>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="rounded-full bg-primary/10 px-3 py-1.5 font-semibold tabular-nums text-primary" aria-label="Saldo">{formatRupiah(profile?.saldo ?? 0)}</span>
            <Link href="/profile" className={`hidden rounded-lg px-3 py-2 font-medium text-muted hover:bg-slate-100 hover:text-ink sm:inline-block ${focusRing}`}>Akun</Link>
            {isAdmin && <Link href="/admin" className={`hidden rounded-lg px-3 py-2 font-medium text-secondary hover:bg-secondary/10 sm:inline-block ${focusRing}`}>Admin</Link>}
            <form action={logoutAction}>
              <button className={`min-h-10 rounded-lg px-3 py-2 text-muted hover:bg-slate-100 hover:text-ink ${focusRing}`}>Keluar</button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:py-6">
        <SiteBanner />
        {children}
        <LegalLinks className="pt-6" />
      </main>
      <BottomNav items={isAdmin ? [...NAV, { href: "/admin", label: "Admin", icon: "⚙" }] : NAV} />
    </div>
  );
}
