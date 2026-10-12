import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

import { toCatalogProducts, type CatalogProduct, type CatalogRow } from "./products";
export type { CatalogProduct } from "./products";

export const CATALOG_TAG = "catalog";

/**
 * Whole active catalogue, cached for 5 minutes and shared by every visitor on the instance:
 * browsing costs ONE database read per window instead of one per page view. Only user-safe
 * columns are selected (never cost_price / margin / raw). Checkout re-reads the real price.
 */
export const getCatalog = unstable_cache(
  async (): Promise<CatalogProduct[]> => {
    const db = createAdminClient();
    const { data, error } = await db
      .from("products_cache")
      .select("id,name,display_name,category,display_category,description,sort_order,sell_price,is_available")
      .eq("is_active", true)
      .limit(5000);
    if (error) throw new Error(`catalog read failed: ${error.message}`);
    return toCatalogProducts((data ?? []) as CatalogRow[]);
  },
  ["catalog-v1"],
  { revalidate: 300, tags: [CATALOG_TAG] },
);
