import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { Brand } from "./Logo";
import { NavLinks, type NavItem } from "./NavLinks";
import { focusRing } from "./ui";

const ITEMS: NavItem[] = [
  { href: "/admin", label: "Ringkasan", exact: true },
  { href: "/admin/monitoring", label: "Monitoring" },
  { href: "/admin/transactions", label: "Transaksi" },
  { href: "/admin/users", label: "User" },
  { href: "/admin/invites", label: "Kode Undangan" },
  { href: "/admin/topups", label: "Top-up" },
  { href: "/admin/banks", label: "Rekening Top-up" },
  { href: "/admin/products", label: "Produk & Margin" },
  { href: "/admin/ledger", label: "Mutasi Saldo" },
  { href: "/admin/settings", label: "Pengaturan" },
  { href: "/admin/audit", label: "Audit" },
];

export function AdminShell({ children, email }: { children: React.ReactNode; email: string | null }) {
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-surface md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:block">
          <Link href="/admin" aria-label="Admin — ringkasan" className={`block rounded-lg ${focusRing}`}><Brand /></Link>
          <span className="rounded-full bg-secondary/10 px-2.5 py-1 text-xs font-semibold text-secondary md:mt-3 md:inline-block">Admin</span>
        </div>
        <div className="px-2 pb-2 md:px-3"><NavLinks items={ITEMS} orientation="vertical" /></div>
        <div className="hidden border-t border-slate-100 p-3 text-xs text-muted md:block">
          <p className="truncate" title={email ?? ""}>{email}</p>
          <div className="mt-2 flex gap-3">
            <Link href="/dashboard" className="text-primary hover:underline">Ke toko</Link>
            <form action={logoutAction}><button className="text-muted hover:text-ink">Keluar</button></form>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <main id="main" className="mx-auto max-w-6xl px-4 py-5 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
