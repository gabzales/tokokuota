import { describe, expect, it } from "vitest";
import { fetchRaw } from "@/lib/providers/khfypay/http";

const ok = (body: string, status = 200) =>
  (async () => new Response(body, { status, headers: { "content-type": "application/json" } })) as typeof fetch;

describe("fetchRaw", () => {
  it("returns raw text and parsed json", async () => {
    const r = await fetchRaw("https://x.test/a?k=SECRET", { timeoutMs: 500, fetchImpl: ok('{"a":1}') });
    expect(r.kind).toBe("response");
    if (r.kind === "response") expect(r.raw.json).toEqual({ a: 1 });
  });

  it("keeps non-JSON bodies as text (json undefined)", async () => {
    const r = await fetchRaw("https://x.test", { timeoutMs: 500, fetchImpl: ok("OK|123") });
    expect(r.kind === "response" && r.raw.json).toBeUndefined();
    expect(r.kind === "response" && r.raw.bodyText).toBe("OK|123");
  });

  it("classifies a hang as timeout, never as a business failure", async () => {
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_res, rej) =>
        init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))),
      )) as typeof fetch;
    const r = await fetchRaw("https://x.test", { timeoutMs: 20, fetchImpl: hang });
    expect(r).toEqual({ kind: "transport_error", reason: "timeout" });
  });

  it("classifies network errors without leaking the URL", async () => {
    const boom = (async () => { throw new TypeError("fetch failed https://x.test?k=SECRET"); }) as typeof fetch;
    const r = await fetchRaw("https://x.test?k=SECRET", { timeoutMs: 500, fetchImpl: boom });
    expect(r).toEqual({ kind: "transport_error", reason: "network" });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  it("treats non-2xx as transport trouble (outcome unknown)", async () => {
    const r = await fetchRaw("https://x.test", { timeoutMs: 500, fetchImpl: ok("err", 502) });
    expect(r).toEqual({ kind: "transport_error", reason: "http_error", httpStatus: 502 });
  });
});
