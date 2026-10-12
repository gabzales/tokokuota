import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";
import { loginSchema, registerSchema } from "@/lib/auth/schemas";
import { isAuthorizedCron } from "@/lib/security/cron";
import { isSameOrigin } from "@/lib/security/origin";
import { redactAndTruncate } from "@/lib/security/redact";
import { safeEqual } from "@/lib/security/timing";

const req = (headers: Record<string, string>) => new Request("https://toko-kuota.web.id/api/checkout", { method: "POST", headers });

describe("safeNextPath (no open redirect)", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNextPath("/products/abc?x=1")).toBe("/products/abc?x=1");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "evil", "/a\nb", ""]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
    expect(safeNextPath(null)).toBe("/dashboard");
  });
});

describe("safeEqual / cron / origin", () => {
  it("compares secrets", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  it("cron needs the exact bearer token", () => {
    const s = "x".repeat(20);
    expect(isAuthorizedCron(new Request("https://x.test", { headers: { authorization: `Bearer ${s}` } }), s)).toBe(true);
    expect(isAuthorizedCron(new Request("https://x.test", { headers: { authorization: `Bearer nope` } }), s)).toBe(false);
    expect(isAuthorizedCron(new Request("https://x.test", { headers: { authorization: s } }), s)).toBe(false);
    expect(isAuthorizedCron(new Request("https://x.test"), s)).toBe(false);
  });
  it("JSON endpoint requires a same-origin Origin header", () => {
    expect(isSameOrigin(req({ origin: "https://toko-kuota.web.id", host: "toko-kuota.web.id" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "https://evil.com", host: "toko-kuota.web.id" }))).toBe(false);
    expect(isSameOrigin(req({ host: "toko-kuota.web.id" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "not a url", host: "toko-kuota.web.id" }))).toBe(false);
  });
});

describe("redactAndTruncate", () => {
  it("masks every occurrence and truncates", () => {
    expect(redactAndTruncate("a SECRET b SECRET", ["SECRET"])).toBe("a *** b ***");
    expect(redactAndTruncate("x".repeat(50), [], 10)).toBe("xxxxxxxxxx…[truncated]");
  });
});

describe("auth schemas", () => {
  it("normalizes email and enforces password length", () => {
    expect(loginSchema.parse({ email: " A@B.COM ", password: "x" }).email).toBe("a@b.com");
    expect(registerSchema.safeParse({ email: "a@b.com", password: "short" }).success).toBe(false);
    expect(registerSchema.safeParse({ email: "a@b.com", password: "x".repeat(73) }).success).toBe(false);
    expect(registerSchema.safeParse({ email: "nope", password: "longenough1" }).success).toBe(false);
    expect(registerSchema.parse({ email: "a@b.com", password: "longenough1", fullName: "  " }).fullName).toBeUndefined();
  });
  it("ignores unexpected fields such as role/saldo", () => {
    const out = registerSchema.parse({ email: "a@b.com", password: "longenough1", role: "admin", saldo: 999999 });
    expect(Object.keys(out)).not.toContain("role");
    expect(Object.keys(out)).not.toContain("saldo");
  });
});
