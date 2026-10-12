import Link from "next/link";
import { LegalLinks } from "@/components/Legal";
import { Brand, Logo } from "@/components/Logo";
import { btnPrimary, btnSecondary, focusRing } from "@/components/ui";
import { TopupSimulator } from "./TopupSimulator";
import { BankIcon, ChevronIcon, PhoneIcon, ShieldIcon, StatusIcon, TagIcon, UserPlusIcon, WalletIcon } from "./Icons";

const wrap = "mx-auto w-full max-w-5xl px-4 sm:px-6";

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className={`${wrap} flex items-center justify-between gap-3 py-2.5`}>
        <Link href="/" aria-label="Toko Kuota, beranda" className={`rounded-lg ${focusRing}`}><Brand compact /></Link>
        <nav aria-label="Bagian halaman" className="hidden items-center gap-1 md:flex">
          {[["#fitur", "Keunggulan"], ["#simulasi", "Simulasi"], ["#cara-kerja", "Cara kerja"], ["#faq", "FAQ"]].map(([h, l]) => (
            <a key={h} href={h} className={`press rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-slate-100 hover:text-ink ${focusRing}`}>{l}</a>
          ))}
        </nav>
        <nav aria-label="Akun" className="flex items-center gap-2">
          <Link href="/login" className={`rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-slate-100 ${focusRing}`}>Masuk</Link>
          <Link href="/register" className={`${btnPrimary} !min-h-10 !px-4`}>Daftar</Link>
        </nav>
      </div>
    </header>
  );
}

/** Illustration only: clearly labelled, no real names, prices or customers. */
function PhoneMock() {
  const rows = [
    { name: "Paket data", note: "Berhasil", tone: "bg-emerald-100 text-emerald-800" },
    { name: "Pulsa", note: "Diproses", tone: "bg-amber-100 text-amber-800" },
    { name: "Produk digital", note: "Gagal, saldo kembali", tone: "bg-sky-100 text-sky-800" },
  ];
  return (
    <figure className="animate-float relative mx-auto w-full max-w-[19rem]" aria-label="Ilustrasi tampilan aplikasi">
      <div aria-hidden="true" className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-primary/25 via-secondary/20 to-transparent blur-2xl" />
      <div className="rounded-[2rem] border border-slate-200 bg-white p-3 shadow-2xl shadow-primary/10 ring-1 ring-black/5">
        <div className="rounded-[1.5rem] bg-slate-50 p-4">
          <div className="rounded-2xl bg-gradient-to-br from-primary to-secondary p-4 text-white shadow-lg">
            <p className="text-xs text-white/80">Saldo kamu</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">Rp 150.000</p>
            <div className="mt-3 flex gap-2 text-[11px] font-medium">
              <span className="rounded-full bg-white/20 px-2.5 py-1">Top-up</span>
              <span className="rounded-full bg-white/20 px-2.5 py-1">Beli produk</span>
            </div>
          </div>
          <p className="mb-2 mt-4 text-xs font-semibold text-slate-500">Transaksi terakhir</p>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.name} className="flex items-center justify-between rounded-xl bg-white px-3 py-2.5 text-sm shadow-sm ring-1 ring-slate-100">
                <span className="font-medium text-ink">{r.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.tone}`}>{r.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted">Contoh tampilan (ilustrasi)</figcaption>
    </figure>
  );
}

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_50%_-10%,rgba(124,58,237,0.14),transparent),radial-gradient(40rem_24rem_at_0%_20%,rgba(37,99,235,0.14),transparent)]" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 opacity-[0.35] [background-image:linear-gradient(to_right,rgba(15,23,42,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.06)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <div className={`${wrap} grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14 lg:py-24`}>
        <div className="text-center lg:text-left">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary lg:mx-0">
            <Logo size={18} className="!ring-0" /> Raja Kuota
          </p>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
            Top-up kuota &amp; produk digital,{" "}
            <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">saldo tercatat rapi</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted sm:text-lg lg:mx-0">
            Isi saldo sekali, lalu beli kuota, pulsa, dan produk digital lainnya kapan saja. Setiap transaksi punya status yang jelas dan setiap rupiah tercatat di riwayat saldo.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link href="/register" className={`${btnPrimary} sm:min-w-44`}>Daftar sekarang</Link>
            <Link href="/login" className={`${btnSecondary} sm:min-w-44`}>Masuk</Link>
          </div>
          <ul className="mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-muted lg:justify-start">
            {["Harga tampil sebelum bayar", "Riwayat saldo lengkap", "Nyaman di HP"].map((t) => (
              <li key={t} className="flex items-center gap-1.5"><StatusIcon className="h-4 w-4 text-primary" />{t}</li>
            ))}
          </ul>
        </div>
        <PhoneMock />
      </div>
    </section>
  );
}

const FEATURES = [
  { icon: WalletIcon, title: "Saldo yang bisa dilacak", text: "Top-up, pembelian, dan pengembalian semuanya tercatat di riwayat mutasi. Catatan itu hanya bertambah, tidak bisa diubah atau dihapus." },
  { icon: StatusIcon, title: "Status yang jelas", text: "Setiap transaksi berstatus Diproses, Berhasil, atau Gagal. Kalau gagal, saldo yang terpotong dikembalikan." },
  { icon: TagIcon, title: "Harga tampil di depan", text: "Kamu melihat harga sebelum membeli. Kalau harga berubah saat checkout, kamu diberi tahu dulu, bukan dipotong diam-diam." },
  { icon: ShieldIcon, title: "Data kamu dijaga", text: "Riwayat transaksi dan saldo hanya bisa dilihat pemiliknya, dan percobaan masuk yang berulang dibatasi." },
];

export function Features() {
  return (
    <section id="fitur" aria-labelledby="why" className="bg-white py-14 sm:py-20">
      <div className={wrap}>
        <h2 id="why" className="text-center text-2xl font-bold tracking-tight sm:text-3xl">Kenapa Toko Kuota</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-muted">Dibuat supaya kamu selalu tahu uangmu ada di mana.</p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="reveal group rounded-2xl border border-slate-200 bg-slate-50/60 p-5 transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-white hover:shadow-lg hover:shadow-primary/5 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-white shadow-sm"><Icon className="h-6 w-6" /></span>
              <h3 className="mt-4 font-semibold text-ink">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Simulator() {
  return (
    <section id="simulasi" aria-labelledby="sim" className="py-14 sm:py-20">
      <div className={wrap}>
        <h2 id="sim" className="text-center text-2xl font-bold tracking-tight sm:text-3xl">Isi saldo dengan nominal unik</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-muted">Setiap permintaan top-up mendapat nominal yang berbeda, jadi transfermu bisa dikenali. Coba sendiri.</p>
        <div className="mt-8"><TopupSimulator /></div>
      </div>
    </section>
  );
}

const STEPS = [
  { icon: UserPlusIcon, title: "Daftar & masuk", text: "Buat akun dengan email, lalu masuk dari HP atau komputer." },
  { icon: BankIcon, title: "Isi saldo", text: "Top-up lewat transfer bank. Saldo masuk sebesar nominal yang kamu transfer." },
  { icon: PhoneIcon, title: "Beli & pantau", text: "Pilih produk, masukkan nomor tujuan, lalu pantau statusnya di riwayat." },
];

export function Steps() {
  return (
    <section id="cara-kerja" aria-labelledby="how" className="py-14 sm:py-20">
      <div className={wrap}>
        <h2 id="how" className="text-center text-2xl font-bold tracking-tight sm:text-3xl">Cara kerjanya</h2>
        <ol className="mt-10 grid gap-6 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="reveal relative rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
              <span className="absolute -top-3 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-ink text-xs font-bold text-white" aria-hidden="true">{i + 1}</span>
              <Icon className="mx-auto mt-2 h-8 w-8 text-primary" />
              <h3 className="mt-3 font-semibold"><span className="sr-only">Langkah {i + 1}: </span>{title}</h3>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 text-center text-sm text-muted">Kuota internet, pulsa, dan produk digital lainnya. Katalog lengkap tampil setelah kamu masuk.</p>
      </div>
    </section>
  );
}

const FAQ = [
  { q: "Bagaimana cara mengisi saldo?", a: "Pilih nominal di halaman Top-up, lalu transfer ke rekening yang tertera dengan nominal persis seperti yang ditampilkan. Saldo masuk sebesar nominal yang kamu transfer." },
  { q: "Apa yang terjadi kalau transaksi gagal?", a: "Saldo yang terpotong dikembalikan sesuai ketentuan di Syarat & Ketentuan, dan pengembaliannya tercatat di riwayat saldo." },
  { q: "Berapa lama transaksi diproses?", a: "Statusnya tampil di halaman riwayat dan diperbarui otomatis. Lamanya mengikuti penyedia produk." },
  { q: "Bagaimana kalau saya sudah transfer tapi saldo belum masuk?", a: "Hubungi admin dengan bukti transfer. Transfer yang telat atau nominalnya tidak cocok dicek dan dikreditkan secara manual." },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq" className="bg-white py-14 sm:py-20">
      <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        <h2 id="faq" className="text-center text-2xl font-bold tracking-tight sm:text-3xl">Pertanyaan umum</h2>
        <div className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg font-medium text-ink ${focusRing}`}>
                {f.q}
                <ChevronIcon className="h-5 w-5 shrink-0 text-muted transition group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <p className="faq-body mt-3 text-sm leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="px-4 py-14 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-4xl overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-secondary px-6 py-12 text-center text-white shadow-xl shadow-primary/20 sm:px-12">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Siap isi saldo pertamamu?</h2>
        <p className="mx-auto mt-2 max-w-md text-white/85">Daftar gratis dan lihat katalog produk setelah masuk.</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/register" className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-6 py-2 text-sm font-semibold text-primary shadow-sm hover:bg-slate-50 ${focusRing}`}>Daftar sekarang</Link>
          <Link href="/login" className={`inline-flex min-h-11 items-center justify-center rounded-lg border border-white/50 px-6 py-2 text-sm font-semibold text-white hover:bg-white/10 ${focusRing}`}>Sudah punya akun? Masuk</Link>
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white py-8">
      <div className={`${wrap} flex flex-col items-center gap-4 text-center`}>
        <Brand />
        <LegalLinks />
        <p className="text-xs text-muted">&copy; {new Date().getFullYear()} Toko Kuota (Raja Kuota). Semua hak dilindungi.</p>
      </div>
    </footer>
  );
}
