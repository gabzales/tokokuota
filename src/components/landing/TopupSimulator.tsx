"use client";

import Link from "next/link";
import { useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { SubmitButton } from "@/components/SubmitButton";
import { btnPrimary } from "@/components/ui";
import { ValidatedField, ValidatedForm } from "@/components/ValidatedForm";
import { amountError, digitsOnly, formatThousands, randomCode, simulateTopup } from "@/lib/validation";

// Example numbers for the demo only: the real limits are set by the shop owner in the admin settings.
const SIM_MIN = 10_000;
const SIM_MAX = 2_000_000;
const PRESETS = [20_000, 50_000, 100_000, 200_000];
const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

export function TopupSimulator() {
  const [result, setResult] = useState<ReturnType<typeof simulateTopup> | null>(null);
  const [preset, setPreset] = useState<number | undefined>();
  const [round, setRound] = useState(0);

  return (
    <div className="grid items-start gap-6 md:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Simulasi</p>
        <h3 className="mt-1 text-lg font-semibold">Coba hitung nominal transfer</h3>
        <ValidatedForm className="mt-4 space-y-4" onValidSubmit={(fd) => { setResult(simulateTopup(Number(digitsOnly(String(fd.get("amount") ?? ""))), randomCode(1, 999))); setRound((n) => n + 1); }}>
          <ValidatedField
            key={preset ?? "free"} name="amount" label="Mau isi saldo berapa?" inputMode="numeric" placeholder="50.000" maxLength={13}
            defaultValue={preset ? String(preset) : ""} parse={digitsOnly} format={formatThousands}
            validate={amountError(SIM_MIN, SIM_MAX)} hint={`Contoh batas: ${rp(SIM_MIN)} sampai ${rp(SIM_MAX)}.`}
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Pilihan cepat nominal">
            {PRESETS.map((n) => (
              <button key={n} type="button" onClick={() => setPreset(n)} aria-pressed={preset === n}
                className={`press rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${preset === n ? "border-primary bg-primary text-white" : "border-slate-300 bg-white text-ink hover:border-primary/50"}`}>
                {rp(n)}
              </button>
            ))}
          </div>
          <SubmitButton pendingText="Menghitung…">{result ? "Hitung ulang" : "Hitung nominal transfer"}</SubmitButton>
        </ValidatedForm>
      </div>

      <div aria-live="polite" className="min-h-48">
        {result ? (
          <div key={round} className="animate-pop rounded-2xl bg-gradient-to-br from-primary to-secondary p-6 text-white shadow-xl shadow-primary/20">
            <p className="text-sm text-white/80">Transfer persis sebesar</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <p className="text-3xl font-extrabold tabular-nums">{rp(result.total)}</p>
              <CopyButton value={String(result.total)} label="nominal" />
            </div>
            <dl className="mt-4 space-y-1 rounded-xl bg-white/10 p-3 text-sm">
              <div className="flex justify-between"><dt className="text-white/80">Nominal top-up</dt><dd className="tabular-nums">{rp(result.base)}</dd></div>
              <div className="flex justify-between"><dt className="text-white/80">Kode unik</dt><dd className="tabular-nums">+ {result.code}</dd></div>
              <div className="flex justify-between border-t border-white/20 pt-1 font-semibold"><dt>Saldo yang masuk</dt><dd className="tabular-nums">{rp(result.total)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-white/80">Kode unik hanya penanda supaya transfermu dikenali, bukan biaya: saldo masuk sebesar yang kamu transfer. Ini contoh; nominal asli dibuat sistem saat kamu mengajukan top-up.</p>
            <Link href="/register" className="press mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">Daftar untuk top-up sungguhan</Link>
          </div>
        ) : (
          <div className="flex h-full min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 text-center">
            <p className="font-medium text-ink">Hasil simulasi tampil di sini</p>
            <p className="mt-1 max-w-xs text-sm text-muted">Masukkan nominal lalu tekan hitung untuk melihat bagaimana nominal unik bekerja.</p>
            <Link href="/register" className={`${btnPrimary} mt-4 !min-h-10`}>Daftar gratis</Link>
          </div>
        )}
      </div>
    </div>
  );
}
