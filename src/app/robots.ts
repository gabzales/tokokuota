import type { MetadataRoute } from "next";

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://toko-kuota.web.id";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/terms", "/privacy"],
      disallow: ["/admin", "/api", "/webhook", "/dashboard", "/products", "/transactions", "/topup", "/profile", "/mfa", "/login", "/register", "/forgot-password", "/reset-password", "/auth"],
    },
    sitemap: `${site}/sitemap.xml`,
  };
}
