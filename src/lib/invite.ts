// Invite codes (0007). Plain functions only (no zod) so the register form can import them client-side.
// Format: TK-XXXX-XXXX-XXXX (hex). People paste codes from WhatsApp, so spaces, case and missing dashes are forgiven.

export const INVITE_CODE_RE = /^TK-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

export function normalizeInviteCode(input: string): string {
  const s = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return /^TK[0-9A-F]{12}$/.test(s) ? `TK-${s.slice(2, 6)}-${s.slice(6, 10)}-${s.slice(10, 14)}` : s;
}

export const inviteCodeError = (v: string): string | null => {
  if (!v.trim()) return "Kode undangan wajib diisi";
  return INVITE_CODE_RE.test(normalizeInviteCode(v)) ? null : "Format kode belum benar, contoh: TK-1A2B-3C4D-5E6F";
};
