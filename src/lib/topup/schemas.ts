import { z } from "zod";

const required = z.string().trim().min(1, "Wajib diisi");
const uuid = z.string().uuid();
const note = z.string().trim().min(3, "Catatan minimal 3 karakter").max(300, "Catatan maksimal 300 karakter");

export const createTopupSchema = z.object({
  bank: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, "Bank tidak valid"),
  // "" must be an error, never 0
  amount: required.pipe(z.coerce.number().int("Nominal harus bilangan bulat").min(1, "Nominal tidak valid").max(1_000_000_000, "Nominal terlalu besar")),
  idempotencyKey: uuid,
});
export const cancelTopupSchema = z.object({ requestId: uuid });
export const confirmTopupSchema = z.object({ requestId: uuid, note });

export const resolveTransferSchema = z
  .object({
    transferId: uuid,
    action: z.enum(["CREDIT", "IGNORE"]),
    userEmail: z.string().trim().toLowerCase().max(254).optional(),
    note,
  })
  .superRefine((v, ctx) => {
    if (v.action === "CREDIT" && !v.userEmail) ctx.addIssue({ code: "custom", path: ["userEmail"], message: "Email user wajib diisi untuk mengkredit" });
  });

export const bankSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, "Kode bank 2–10 huruf/angka"),
  bank_name: z.string().trim().min(2, "Nama bank minimal 2 karakter").max(60),
  account_number: z.string().trim().regex(/^[0-9]{5,30}$/, "Nomor rekening 5–30 digit angka"),
  account_holder: z.string().trim().min(2, "Nama pemilik minimal 2 karakter").max(100),
  is_active: z.enum(["true", "false"]).transform((v) => v === "true"),
  sort_order: required.pipe(z.coerce.number().int().min(-1000).max(1000)),
});
