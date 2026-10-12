import type { Metadata } from "next";
import { Faq, Features, FinalCta, Hero, LandingFooter, LandingHeader, Simulator, Steps } from "@/components/landing/Landing";

export const metadata: Metadata = {
  title: "Toko Kuota — Top-up kuota & produk digital",
  description: "Isi saldo, beli kuota, pulsa, dan produk digital lainnya. Harga tampil sebelum bayar, status transaksi jelas, dan riwayat saldo tercatat rapi.",
  openGraph: {
    title: "Toko Kuota — Top-up kuota & produk digital",
    description: "Saldo tercatat rapi, status transaksi jelas, harga tampil sebelum bayar.",
    type: "website",
    locale: "id_ID",
    siteName: "Toko Kuota (Raja Kuota)",
  },
};

// Static page: no auth call, no database.
export default function Home() {
  return (
    <>
      <LandingHeader />
      <main id="main">
        <Hero />
        <Features />
        <Simulator />
        <Steps />
        <Faq />
        <FinalCta />
      </main>
      <LandingFooter />
    </>
  );
}
