export interface CatalogProduct {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  sell_price: number;
  is_available: boolean;
}

export interface CatalogRow {
  id: string;
  name: string;
  display_name: string | null;
  category: string | null;
  display_category: string | null;
  description: string | null;
  sort_order: number;
  sell_price: number;
  is_available: boolean;
}

/** Application-owned display metadata wins over the provider's naming. */
export function toCatalogProducts(rows: CatalogRow[]): CatalogProduct[] {
  return [...rows]
    .sort((a, b) => a.sort_order - b.sort_order || (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name))
    .map((r) => ({
      id: r.id,
      name: r.display_name ?? r.name,
      category: r.display_category ?? r.category,
      description: r.description,
      sell_price: r.sell_price,
      is_available: r.is_available,
    }));
}

