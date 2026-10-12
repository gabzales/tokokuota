import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CopyButton } from "@/components/CopyButton";
import { Countdown } from "@/components/Countdown";
import { CancelTopupForm } from "@/components/TopupForms";
import { Badge, Card, linkCls, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/require-user";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { getPublicSettings } from "@/lib/settings/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getBankAccount } from "@/lib/topup/banks";
import { cancelTopupAction } from "../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Req { id: string; bank_code: string; base_amount: number; unique_code: number; total_amount: number; status: string; expires_at: string; paid_at: string | null }

export default async function TopupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser();
  const supabase = await createServerSupabase();

  // Read through the user's own session (RLS): somebody else's request id simply 404s.
  const { data } = await supabase
    .from("topup_requests").select("id,bank_code,base_amount,unique_code,total_amount,status,expires_at,paid_at")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  const r = data as Req | null;
  if (!r) notFound();

  const expired = r.status === "PENDING" && new Date(r.expires_at).getTime() < Date.now();
  const status = expired ? "EXPIRED" : r.status;
  const pending = status === "PENDING";
  const bank = pending ? await getBankAccount(r.bank_code) : null;
  const support = (await getPublicSettings().catch(() => null))?.support_contact;

  return (
    <AppShell>
      {pending && <AutoRefresh />}
      <Link href="/topup" className={`text-sm ${linkCls}`}>← Top-up</Link>
      <PageHeader title="Instruksi transfer" actions={<Badge kind={status}>{status === "PENDING" ? "Menunggu pembayaran" : status === "PAID" ? "Berhasil" : status === "EXPIRED" ? "Kedaluwarsa" : "Dibatalkan"}</Badge>} />

      {status === "PAID" && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Pembayaran diterima{r.paid_at ? ` pada ${formatDateTime(r.paid_at)}` : ""}. Saldo bertambah {formatRupiah(r.total_amount)}.
        </p>
      )}
      {status === "EXPIRED" && (
        <p role="status" className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-800">
          Permintaan ini sudah kedaluwarsa. <strong>Jika kamu sudah terlanjur transfer</strong>, uangnya tidak hilang: hubungi admin dengan bukti transfer{support ? ` (${support})` : ""} untuk dikreditkan manual.
        </p>
      )}
      {status === "CANCELLED" && <p role="status" className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-800">Permintaan ini dibatalkan.</p>}

      {pending && bank && (
        <Card className="max-w-lg space-y-5">
          <div>
            <p className="text-sm text-muted">Transfer PERSIS sebesar</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <p className="text-3xl font-bold tabular-nums text-primary">{formatRupiah(r.total_amount)}</p>
              <CopyButton value={String(r.total_amount)} label="nominal" />
            </div>
            <p className="mt-1 text-xs text-muted">Nominal {formatRupiah(r.base_amount)} + kode unik {r.unique_code}. Saldo yang masuk = nominal yang kamu transfer. <strong>Jangan dibulatkan</strong>, angka harus sama persis agar terdeteksi otomatis.</p>
          </div>
          <dl className="divide-y divide-slate-100 text-sm">
            <div className="flex justify-between gap-3 py-2"><dt className="text-muted">Bank</dt><dd className="font-medium">{bank.bank_name}</dd></div>
            <div className="flex items-center justify-between gap-3 py-2"><dt className="text-muted">No. rekening</dt><dd className="flex items-center gap-2 font-mono font-medium">{bank.account_number}<CopyButton value={bank.account_number} label="nomor rekening" /></dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-muted">Atas nama</dt><dd className="text-right font-medium">{bank.account_holder}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-muted">Bayar sebelum</dt><dd className="text-right font-medium">{formatDateTime(r.expires_at)} (<Countdown expiresAt={r.expires_at} />)</dd></div>
          </dl>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Halaman ini diperbarui otomatis. Jika transfer sudah masuk tapi saldo belum bertambah dalam beberapa menit, hubungi admin{support ? ` (${support})` : ""} dan siapkan bukti transfer.
          </p>
          <CancelTopupForm action={cancelTopupAction} requestId={r.id} />
        </Card>
      )}
    </AppShell>
  );
}
