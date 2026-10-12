import { getPublicSettings } from "@/lib/settings/server";

/** Maintenance notice + announcement, from one cached settings read (60 s). */
export async function SiteBanner() {
  let s;
  try { s = await getPublicSettings(); } catch { return null; }
  if (!s.maintenance_mode && !s.announcement) return null;
  return (
    <div className="space-y-2">
      {s.maintenance_mode && (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Sedang pemeliharaan.</strong> Pembelian baru dinonaktifkan sementara.
          {s.support_contact && <> Hubungi: {s.support_contact}</>}
        </p>
      )}
      {s.announcement && (
        <p role="note" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-ink">{s.announcement}</p>
      )}
    </div>
  );
}
