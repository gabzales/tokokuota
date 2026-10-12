import { z } from "zod";
import type { ProviderProduct } from "@/lib/providers/types";
import type { SyncProductRow } from "@/lib/transactions/rpc";

// Product normalization boundary: whatever a provider parser produces must pass this before it
// can reach the database. Anything else is rejected as a whole (fail closed).
const normalized = z.object({
  providerCode: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).nullable(),
  costPrice: z.number().int().min(0).max(1_000_000_000),
  isAvailable: z.boolean(),
  raw: z.unknown(),
});

export class CatalogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogValidationError";
  }
}

export function normalizeProducts(products: ProviderProduct[]): SyncProductRow[] {
  if (products.length === 0) throw new CatalogValidationError("provider returned an empty catalogue");
  if (products.length > 20000) throw new CatalogValidationError("catalogue too large");

  const seen = new Set<string>();
  return products.map((p, i) => {
    const r = normalized.safeParse(p);
    if (!r.success) throw new CatalogValidationError(`product #${i}: ${r.error.issues[0]?.message ?? "invalid"}`);
    if (seen.has(r.data.providerCode)) throw new CatalogValidationError(`duplicate provider code ${r.data.providerCode}`);
    seen.add(r.data.providerCode);
    return {
      provider_code: r.data.providerCode,
      name: r.data.name,
      category: r.data.category && r.data.category.length > 0 ? r.data.category : null,
      cost_price: r.data.costPrice,
      is_available: r.data.isAvailable,
      raw: r.data.raw ?? null,
    };
  });
}
