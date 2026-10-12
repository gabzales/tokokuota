import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(72),
});

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email tidak valid").max(254),
  password: z.string().min(8, "Password minimal 8 karakter").max(72, "Password maksimal 72 karakter"),
  fullName: z
    .string()
    .trim()
    .max(60, "Nama maksimal 60 karakter")
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email tidak valid").max(254),
});

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password minimal 8 karakter").max(72, "Password maksimal 72 karakter"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Konfirmasi password tidak sama" });

export const profileNameSchema = z.object({
  fullName: z.string().trim().max(60, "Nama maksimal 60 karakter").optional().transform((v) => (v ? v : undefined)),
});

export const changePasswordSchema = z
  .object({
    current: z.string().min(1, "Password saat ini wajib diisi").max(72),
    password: z.string().min(8, "Password minimal 8 karakter").max(72, "Password maksimal 72 karakter"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Konfirmasi password tidak sama" })
  .refine((v) => v.password !== v.current, { path: ["password"], message: "Password baru harus berbeda dari yang lama" });
