import { safeEqual } from "./timing";

/** Vercel Cron authenticates with `Authorization: Bearer $CRON_SECRET`. */
export function isAuthorizedCron(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(header);
  return m ? safeEqual(m[1]!, secret) : false;
}
