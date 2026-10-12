import { handleWebhook } from "@/lib/webhook/runtime";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string; rest?: string[] }> };

// THE callback URL to register with the provider:
//   https://tokokuota.web.id/webhook/<WEBHOOK_SECRET>      → provider appends ?message=<message>
// The optional catch-all means it also works if the provider appends its own path segment (e.g. …/<WEBHOOK_SECRET>/webhook?message=…).
// The secret is still the FIRST path segment and is the only thing that authenticates the call.
export const GET = async (req: Request, ctx: Ctx) => handleWebhook(req, (await ctx.params).token);
export const POST = async (req: Request, ctx: Ctx) => handleWebhook(req, (await ctx.params).token);
