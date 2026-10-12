import { formatRupiah } from "@/lib/format";
import type { CreateTopupOutcome } from "./rpc";

export function createTopupMessage(outcome: Exclude<CreateTopupOutcome, "CREATED" | "EXISTING">, limits: { min: number; max: number }): string {
  switch (outcome) {
    case "TOPUP_DISABLED": return "Top-up otomatis belum tersedia.";
    case "USER_NOT_FOUND": return "Akun tidak ditemukan. Silakan login ulang.";
    case "USER_INACTIVE": return "Akun tidak aktif. Hubungi admin.";
    case "BANK_UNAVAILABLE": return "Bank yang dipilih tidak tersedia.";
    case "AMOUNT_OUT_OF_RANGE": return `Nominal top-up harus antara ${formatRupiah(limits.min)} dan ${formatRupiah(limits.max)}.`;
    case "TOO_MANY_PENDING": return "Kamu masih punya 3 permintaan top-up yang belum dibayar. Selesaikan atau batalkan salah satunya dulu.";
    case "NO_CODE_AVAILABLE": return "Nominal ini sedang penuh. Coba nominal lain atau beberapa saat lagi.";
  }
}

export const TRANSFER_REASONS: Record<string, string> = {
  NO_MATCH: "Tidak ada permintaan yang cocok",
  EXPIRED: "Masuk setelah permintaan kedaluwarsa",
  USER_INACTIVE: "Akun user nonaktif",
  MATCHES_PAID_REQUEST: "Nominal sama dengan permintaan yang sudah dibayar (kemungkinan sudah dikonfirmasi manual)",
};
