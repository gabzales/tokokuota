import type { MetadataRoute } from "next";

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://toko-kuota.web.id";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/terms", "/privacy"].map((p) => ({ url: `${site}${p}`, changeFrequency: "monthly" as const, priority: p === "" ? 1 : 0.3 }));
}
