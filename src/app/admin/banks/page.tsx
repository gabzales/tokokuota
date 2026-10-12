import { BankForm } from "@/components/AdminForms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { listBanks } from "@/lib/admin/queries";
import { upsertBankAction } from "../actions";

export const metadata = { title: "Rekening Top-up — Admin" };

export default async function BanksPage() {
  const banks = await listBanks();
  return (
    <>
      <PageHeader title="Rekening Top-up" description="Rekening tujuan transfer yang ditampilkan ke user. Nomor rekening diisi di sini, bukan di kode." />
      <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Rekening tidak bisa diubah selama masih ada permintaan top-up yang belum selesai, supaya transfer user tidak salah alamat. Untuk mengganti: nonaktifkan, tunggu permintaan selesai, lalu ubah.
      </p>
      <div className="space-y-4">
        {banks.map((b) => (
          <Card key={b.id}>
            <div className="mb-3 flex items-center gap-2"><h2 className="font-semibold">{b.bank_name}</h2><Badge kind={b.is_active ? "ACTIVE" : "INACTIVE"}>{b.is_active ? "Aktif" : "Nonaktif"}</Badge></div>
            <BankForm action={upsertBankAction} bank={b} />
          </Card>
        ))}
        <Card>
          <h2 className="mb-3 font-semibold">Tambah rekening</h2>
          <BankForm action={upsertBankAction} />
        </Card>
      </div>
    </>
  );
}
