import { z } from "zod";

export const checkoutInputSchema = z.object({
  productId: z.string().uuid(),
  // Provider target format is not documented, so only a safe charset/length is enforced.
  destination: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z._@:\-]{3,64}$/, "Nomor/ID tujuan tidak valid"),
  idempotencyKey: z.string().uuid(),
  expectedPrice: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutInputSchema>;
