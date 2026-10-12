import { describe, expect, it, vi } from "vitest";
import { handleWebhookRequest, MAX_MESSAGE_LENGTH } from "@/lib/webhook/handler";
import type { WebhookInput } from "@/lib/providers/khfypay/webhook";

const SECRET = "s".repeat(32);
const mk = (process = vi.fn(async (_i: WebhookInput) => "UNPARSED" as const), getSecret = () => SECRET) => ({ deps: { getSecret, process }, process });
const call = (url: string, init?: RequestInit, deps = mk(), pathToken?: string) => handleWebhookRequest(new Request(url, init), deps.deps, pathToken).then(async (r) => ({ status: r.status, body: await r.json() as Record<string, unknown>, deps }));

describe("webhook HTTP handler", () => {
  it("documented format: GET /webhook/<token>?message=… is processed", async () => {
    const d = mk();
    const r = await call("https://x.test/webhook/x?message=hello", undefined, d, SECRET);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, outcome: "UNPARSED" });
    expect(d.process.mock.calls[0]![0].method).toBe("GET");
    expect(d.process.mock.calls[0]![0].query.get("message")).toBe("hello");
  });

  it("path token (/webhook/<token>) works, and a wrong one is rejected", async () => {
    const ok = mk();
    const r = await call("https://x.test/webhook/whatever?message=hello", undefined, ok, SECRET);
    expect(r.status).toBe(200);
    expect(ok.process.mock.calls[0]![0].query.get("message")).toBe("hello");
    const bad = mk();
    expect((await call("https://x.test/webhook/whatever?message=hello", undefined, bad, "nope")).status).toBe(401);
    expect(bad.process).not.toHaveBeenCalled();
  });

  it("the secret is stripped before anything can be logged or stored", async () => {
    const d = mk();
    await call(`https://x.test/webhook/x?token=${SECRET}&message=hello`, undefined, d, SECRET);
    const input = d.process.mock.calls[0]![0];
    expect(input.query.has("token")).toBe(false);
    expect(JSON.stringify([...input.query.entries()])).not.toContain(SECRET);
  });

  it("missing / wrong path token => 401 and nothing is processed", async () => {
    for (const t of [undefined, "", "wrong", `${SECRET}x`]) {
      const d = mk();
      expect((await call("https://x.test/webhook/x?message=x", undefined, d, t)).status).toBe(401);
      expect(d.process).not.toHaveBeenCalled();
    }
  });

  it("a ?token= query is NOT accepted (secrets must not travel in query strings)", async () => {
    const d = mk();
    expect((await call(`https://x.test/webhook?token=${SECRET}&message=x`, undefined, d)).status).toBe(401);
    expect(d.process).not.toHaveBeenCalled();
  });

  it("secret not configured => 503 (fail closed)", async () => {
    const d = mk(undefined, () => { throw new Error("unset"); });
    const r = await call("https://x.test/webhook/x?message=x", undefined, d, SECRET);
    expect(r.status).toBe(503);
    expect(d.process).not.toHaveBeenCalled();
  });

  it("POST form / JSON compatibility works with the path token", async () => {
    const d = mk();
    const r = await call("https://x.test/webhook/x", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "message=abc" }, d, SECRET);
    expect(r.status).toBe(200);
    expect(d.process.mock.calls[0]![0]).toMatchObject({ method: "POST", bodyText: "message=abc" });
  });

  it("oversized message / body are rejected", async () => {
    const d = mk();
    expect((await call(`https://x.test/webhook/x?message=${"a".repeat(MAX_MESSAGE_LENGTH + 1)}`, undefined, d, SECRET)).status).toBe(400);
    expect((await call("https://x.test/webhook/x", { method: "POST", body: "a".repeat(9000) }, d, SECRET)).status).toBe(413);
    expect(d.process).not.toHaveBeenCalled();
  });

  it("processing errors => 500 with no internals, so the provider can retry", async () => {
    const d = mk(vi.fn(async () => { throw new Error("db password=hunter2"); }));
    const r = await call("https://x.test/webhook/x?message=x", undefined, d, SECRET);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("hunter2");
  });
});
