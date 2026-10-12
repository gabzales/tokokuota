import { safeEqual } from "@/lib/security/timing";
import type { WebhookInput } from "@/lib/providers/khfypay/webhook";
import type { WebhookOutcome } from "@/lib/transactions/webhook-processor";

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_BODY_BYTES = 8 * 1024;

export interface WebhookHandlerDeps {
  /** Returns the shared secret, or throws when it is not configured (=> fail closed, 503). */
  getSecret: () => string;
  process: (input: WebhookInput) => Promise<WebhookOutcome>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * HTTP layer of the webhook. The provider documents no signature, so the only authenticity check
 * is a secret that WE put in the callback URL we register (path `/webhook/<token>`).
 * It is removed from everything that is logged or stored.
 * It is not a provider signature: finalization still depends on correlation + state machine
 * (+ /history verification in Tahap 2B).
 */
export async function handleWebhookRequest(req: Request, deps: WebhookHandlerDeps, pathToken?: string): Promise<Response> {
  let secret: string;
  try {
    secret = deps.getSecret();
  } catch {
    return json(503, { ok: false, error: "webhook not configured" });
  }

  const url = new URL(req.url);
  // Token comes ONLY from the path /webhook/<token> (route param). A ?token= query is ignored on
  // purpose: query strings end up in access logs.
  const token = pathToken;
  if (!token || !safeEqual(token, secret)) return json(401, { ok: false, error: "unauthorized" });

  const query = new URLSearchParams(url.searchParams);
  query.delete("token"); // never persist the secret in audit logs

  let bodyText = "";
  if (req.method === "POST") {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return json(413, { ok: false, error: "payload too large" });
    bodyText = await req.text();
    if (new TextEncoder().encode(bodyText).length > MAX_BODY_BYTES) return json(413, { ok: false, error: "payload too large" });
  }

  const input: WebhookInput = { method: req.method, query, contentType: req.headers.get("content-type"), bodyText };

  if ((query.get("message") ?? "").length > MAX_MESSAGE_LENGTH) {
    return json(400, { ok: false, error: "message too long" });
  }

  try {
    const outcome = await deps.process(input);
    return json(200, { ok: true, outcome });
  } catch {
    // Database trouble etc.: 500 lets the provider retry. Details stay in server logs.
    return json(500, { ok: false, error: "temporary error" });
  }
}
