"use client";

import { usePathname } from "next/navigation";
import { IntentLink } from "./IntentLink";

export interface NavItem { href: string; label: string; icon?: string; exact?: boolean }

function useIsActive() {
  const path = usePathname();
  return (i: NavItem) => (i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`));
}

/** Top/side navigation with aria-current. */
export function NavLinks({ items, orientation = "horizontal" }: { items: NavItem[]; orientation?: "horizontal" | "vertical" }) {
  const active = useIsActive();
  return (
    <nav aria-label="Menu utama" className={orientation === "vertical" ? "flex flex-col gap-1" : "flex gap-1 overflow-x-auto"}>
      {items.map((i) => (
        <IntentLink key={i.href} href={i.href} ariaCurrent={active(i) ? "page" : undefined}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
            active(i) ? "bg-primary/10 text-primary" : "text-muted hover:bg-slate-100 hover:text-ink"}`}>
          {i.label}
        </IntentLink>
      ))}
    </nav>
  );
}

/** Mobile bottom tab bar (user app). */
export function BottomNav({ items }: { items: NavItem[] }) {
  const active = useIsActive();
  return (
    <nav aria-label="Menu bawah" className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-surface/95 backdrop-blur md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <ul className="mx-auto flex max-w-md">
        {items.map((i) => (
          <li key={i.href} className="flex-1">
            <IntentLink href={i.href} ariaCurrent={active(i) ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 ${active(i) ? "text-primary" : "text-muted"}`}>
              <span aria-hidden="true" className="text-lg leading-none">{i.icon}</span>
              {i.label}
            </IntentLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
