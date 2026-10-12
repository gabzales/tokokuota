import type { Metadata } from "next";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

export const viewport = { themeColor: "#2563EB" };

export const metadata: Metadata = {
  title: "Toko Kuota — Raja Kuota",
  description: "Top-up kuota, pulsa, dan produk digital.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow">
          Lompat ke konten
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
