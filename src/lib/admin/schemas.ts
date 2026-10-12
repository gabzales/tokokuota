import { z } from "zod";

const optionalText = (max: number) => z.string().max(max).transform((v) => v.trim());
// An empty field must be an error, never a silent 0 (z.coerce.number() turns "" into 0, which for a
// margin would mean "sell at cost").
const required = z.string().trim().min(1, "Wajib diisi");
const rupiah = required.pipe(z.coerce.number().int("Harus bilangan bulat").min(0, "Tidak boleh negatif").max(1_000_000_000, "Terlalu besar"));
const uuid = z.string().uuid();

export const productUpdateSchema = z.object({
  productId: uuid,
  margin: rupiah,
  is_active: z.enum(["true", "false"]).transform((v) => v === "true"),
  display_name: optionalText(200),
  display_category: optionalText(100),
  sort_order: required.pipe(z.coerce.number().int().min(-100000).max(100000)),
  description: optionalText(1000),
});

export const bulkMarginSchema = z
  .object({
    mode: z.enum(["FLAT", "PERCENT"]),
    value: required.pipe(z.coerce.number().int("Harus bilangan bulat").min(0, "Tidak boleh negatif")),
    category: optionalText(100),
    onlyActive: z.enum(["true", "false"]).transform((v) => v === "true"),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "PERCENT" && v.value > 1000) ctx.addIssue({ code: "custom", path: ["value"], message: "Persen maksimal 1000" });
    if (v.mode === "FLAT" && v.value > 1_000_000_000) ctx.addIssue({ code: "custom", path: ["value"], message: "Terlalu besar" });
  });

export const topupSchema = z.object({
  userId: uuid,
  amount: required.pipe(z.coerce.number().int("Nominal harus bilangan bulat").min(1, "Nominal minimal Rp 1").max(1_000_000_000, "Nominal terlalu besar")),
  note: optionalText(200),
  idempotencyKey: uuid,
});

export const userFlagsSchema = z.object({
  userId: uuid,
  is_active: z.enum(["true", "false"]).transform((v) => v === "true"),
  role: z.enum(["user", "admin"]),
});

export const resolveReviewSchema = z.object({
  reffId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/),
  note: z.string().trim().min(3, "Catatan minimal 3 karakter").max(500, "Catatan maksimal 500 karakter"),
});

export const sendUnsentSchema = z.object({ transactionId: uuid });

export const inviteCreateSchema = z.object({
  note: optionalText(100),
  validDays: required.pipe(z.coerce.number().int().min(1, "Minimal 1 hari").max(90, "Maksimal 90 hari")),
});
export const inviteRevokeSchema = z.object({ id: uuid });
