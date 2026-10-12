import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Keep visited pages in the browser's router cache briefly so back/forward and repeat visits feel
    // instant. Server actions (checkout, top-up, ...) invalidate it, so money screens refresh after a change.
    staleTimes: { dynamic: 20, static: 180 },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders({
          isDev: process.env.NODE_ENV !== "production",
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          reportOnly: process.env.CSP_REPORT_ONLY === "1",
        }),
      },
    ];
  },
};

export default nextConfig;
