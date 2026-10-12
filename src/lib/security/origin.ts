/**
 * CSRF guard for cookie-authenticated JSON endpoints: the request must carry an Origin header
 * that matches the host it was sent to. (Server Actions already get this check from Next.js.)
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
