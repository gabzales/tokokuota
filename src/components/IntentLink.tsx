"use client";

import Link, { useLinkStatus } from "next/link";
import { useState } from "react";

function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <span aria-hidden="true" className="ml-1.5 inline-block h-3 w-3 animate-[spin_.7s_linear_infinite] rounded-full border-2 border-current border-t-transparent" /> : null;
}

/**
 * Link that (1) loads the page's data as soon as the pointer/finger shows intent (hover, touch, focus), so the
 * click feels instant without prefetching every link on screen (cheaper on serverless + database), and
 * (2) shows a small spinner the moment it is pressed.
 */
export function IntentLink({ href, children, className, ariaCurrent, label }: {
  href: string; children: React.ReactNode; className?: string; ariaCurrent?: "page"; label?: string;
}) {
  const [intent, setIntent] = useState(false);
  const on = () => setIntent(true);
  return (
    <Link href={href} prefetch={intent ? true : null} onMouseEnter={on} onTouchStart={on} onFocus={on} aria-current={ariaCurrent} aria-label={label} className={`press ${className ?? ""}`}>
      {children}
      <Pending />
    </Link>
  );
}
