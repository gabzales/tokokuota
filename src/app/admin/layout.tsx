import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";
import { requireAdmin } from "@/lib/admin/auth";

export const metadata: Metadata = { title: "Admin — Toko Kuota", robots: { index: false, follow: false } };

// The guard lives in the layout AND in every action/RPC: a page can never be reached or
// mutated just because the layout was cached or skipped.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return <AdminShell email={admin.email}>{children}</AdminShell>;
}
