// Client-side validators (plain functions, no zod => no extra JavaScript sent to the browser).
// They mirror the server schemas (src/lib/auth/schemas.ts, transactions/checkout-input.ts,
// topup/schemas.ts); tests/validation.test.ts proves they agree. The SERVER always re-validates.

export type Validator = (value: string) => string | null;

export const emailError: Validator = (v) => {
  const s = v.trim();
  if (!s) return "Email wajib diisi";
  if (s.length > 254) return "Email terlalu panjang";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return "Format email belum benar, contoh: nama@email.com";
  return null;
};

export const loginPasswordError: Validator = (v) => {
  if (!v) return "Password wajib diisi";
  if (v.length > 72) return "Password maksimal 72 karakter";
  return null;
};

export const newPasswordError: Validator = (v) => {
  if (!v) return "Password wajib diisi";
  if (v.length < 8) return `Password minimal 8 karakter (kurang ${8 - v.length})`;
  if (v.length > 72) return "Password maksimal 72 karakter";
  return null;
};

export const confirmPasswordError = (getPassword: () => string): Validator => (v) => {
  if (!v) return "Ulangi password barumu";
  if (v !== getPassword()) return "Konfirmasi password tidak sama";
  return null;
};

export const nameError: Validator = (v) => (v.trim().length > 60 ? "Nama maksimal 60 karakter" : null);

export const destinationError: Validator = (v) => {
  const s = v.trim();
  if (!s) return "Nomor / ID tujuan wajib diisi";
  if (s.length < 3) return "Nomor / ID tujuan terlalu pendek";
  if (s.length > 64) return "Nomor / ID tujuan terlalu panjang";
  if (!/^[0-9A-Za-z._@:\-]+$/.test(s)) return "Hanya huruf, angka, dan tanda . _ - @ : yang boleh";
  return null;
};

/** Digits typed or pasted with dots/spaces ("50.000", "Rp 50 000") => "50000". */
export const digitsOnly = (v: string) => v.replace(/[^\d]/g, "");

export const formatThousands = (digits: string) => (digits ? Number(digits).toLocaleString("id-ID") : "");

export const amountError = (min: number, max: number): Validator => (v) => {
  const d = digitsOnly(v);
  if (!d) return "Nominal wajib diisi";
  const n = Number(d);
  if (!Number.isSafeInteger(n) || n <= 0) return "Nominal tidak valid";
  if (n < min) return `Nominal minimal Rp ${min.toLocaleString("id-ID")}`;
  if (n > max) return `Nominal maksimal Rp ${max.toLocaleString("id-ID")}`;
  return null;
};

// ---- password strength (advisory only: it never blocks a submit) ---------------------------------
const COMMON = ["password", "12345678", "123456789", "qwertyui", "qwerty123", "11111111", "iloveyou", "abc12345", "password1", "admin123"];

export function passwordStrength(v: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!v) return { score: 0, label: "" };
  if (COMMON.some((c) => v.toLowerCase().includes(c))) return { score: 1, label: "Terlalu umum" };
  let pts = 0;
  if (v.length >= 8) pts++;
  if (v.length >= 12) pts++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) pts++;
  if (/\d/.test(v)) pts++;
  if (/[^A-Za-z0-9]/.test(v)) pts++;
  if (v.length < 8) return { score: 1, label: "Terlalu pendek" };
  const score = Math.min(4, Math.max(1, pts - 0)) as 1 | 2 | 3 | 4;
  return { score, label: ["", "Lemah", "Cukup", "Bagus", "Kuat"][score]! };
}

// ---- e-mail typo suggestion ---------------------------------------------------------------------------
const DOMAINS = ["gmail.com", "yahoo.com", "yahoo.co.id", "outlook.com", "hotmail.com", "icloud.com", "ymail.com", "proton.me"];

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}

/** "budi@gmial.com" => "budi@gmail.com"; null when the domain is fine or unknown. */
export function suggestEmail(v: string): string | null {
  const s = v.trim();
  const at = s.lastIndexOf("@");
  if (at < 1) return null;
  const domain = s.slice(at + 1).toLowerCase();
  if (domain.length < 4 || DOMAINS.includes(domain)) return null;
  const best = DOMAINS.map((d) => ({ d, n: distance(domain, d) })).sort((x, y) => x.n - y.n)[0]!;
  return best.n > 0 && best.n <= 2 ? `${s.slice(0, at)}@${best.d}` : null;
}

// ---- landing-page simulation ------------------------------------------------------------------------------
export function simulateTopup(base: number, code: number) {
  return { base, code, total: base + code };
}
export const randomCode = (min: number, max: number, rng: () => number = Math.random) => min + Math.floor(rng() * (max - min + 1));
