export interface HeaderOptions { isDev: boolean; supabaseUrl?: string; reportOnly?: boolean }

/**
 * Baseline security headers. The CSP keeps 'unsafe-inline' for scripts because Next.js emits inline
 * bootstrap scripts; a nonce-based policy (middleware) is the stricter next step. Nothing is loaded
 * from third-party origins: images/fonts are self-hosted, auth is server-side.
 * Set CSP_REPORT_ONLY=1 to log violations instead of blocking (quick rollback without a deploy).
 */
export function buildSecurityHeaders({ isDev, supabaseUrl, reportOnly }: HeaderOptions) {
  let supabaseOrigin = "";
  try { supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : ""; } catch { /* ignore a malformed URL */ }

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin}${isDev ? " ws: wss:" : ""}`.trim(),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const headers = [
    { key: reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", value: csp },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  if (!isDev) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  return headers;
}
