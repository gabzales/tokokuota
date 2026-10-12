import type { CatalogProduct } from "./products";

export const PAGE_SIZE = 24;

export function filterCatalog(
  all: CatalogProduct[],
  opts: { q?: string; category?: string; page?: number },
) {
  const q = opts.q?.trim().toLowerCase();
  let list = all;
  if (opts.category) list = list.filter((p) => p.category === opts.category);
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const total = list.length;
  return {
    items: list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    page,
    total,
    hasNext: page * PAGE_SIZE < total,
  };
}

export const categoriesOf = (all: CatalogProduct[]) =>
  [...new Set(all.map((p) => p.category).filter((c): c is string => !!c))].sort();
