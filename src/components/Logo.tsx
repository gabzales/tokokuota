import Image from "next/image";

/** Raja Kuota crown badge. `unoptimized`: a 256px static file, no image-optimizer quota used. */
export function Logo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <Image src="/logo.png" alt="Logo Raja Kuota" width={size} height={size} unoptimized priority
      className={`rounded-full bg-white ring-1 ring-slate-200 ${className}`} />
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <Logo size={compact ? 30 : 38} />
      <span className="leading-tight">
        <span className="block bg-gradient-to-r from-primary to-secondary bg-clip-text text-base font-bold text-transparent">Toko Kuota</span>
        {!compact && <span className="block text-[11px] font-medium uppercase tracking-wider text-muted">Raja Kuota</span>}
      </span>
    </span>
  );
}
