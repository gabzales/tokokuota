import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema, resetPasswordSchema } from "@/lib/auth/schemas";
import { createTopupSchema } from "@/lib/topup/schemas";
import { checkoutInputSchema } from "@/lib/transactions/checkout-input";
import {
  amountError, confirmPasswordError, destinationError, digitsOnly, emailError, formatThousands, loginPasswordError, nameError,
  newPasswordError, passwordStrength, randomCode, simulateTopup, suggestEmail,
} from "@/lib/validation";

const U = "11111111-1111-4111-8111-111111111111";
const ok = (e: string | null) => e === null;

describe("client validators agree with the server schemas", () => {
  const emails = ["a@b.co", "budi.santoso@gmail.com", "x+tag@sub.domain.id", "nama@email.com", " spasi@depan.com ", "", "plain", "a@b", "a@@b.com", "@b.com", "a b@c.com", "a@b..", "x".repeat(250) + "@a.com"];
  it("e-mail: the browser never rejects what the server accepts, and the common mistakes are caught", () => {
    for (const e of emails) {
      const server = registerSchema.safeParse({ email: e, password: "longenough1" }).success;
      const client = ok(emailError(e));
      if (server) expect(client, `server accepts "${e}" but the client rejects it`).toBe(true);
      if (!client) expect(server, `client rejects "${e}"`).toBe(false);
    }
    for (const bad of ["", "plain", "a@b", "a@@b.com", "@b.com", "a b@c.com"]) expect(ok(emailError(bad))).toBe(false);
    for (const good of ["a@b.co", "budi.santoso@gmail.com", "x+tag@sub.domain.id"]) expect(ok(emailError(good))).toBe(true);
  });
  it("new password: same 8..72 rule as the server", () => {
    for (const p of ["", "1234567", "12345678", "x".repeat(72), "x".repeat(73)]) {
      expect(ok(newPasswordError(p)), `"${p.slice(0, 10)}…" (${p.length})`).toBe(registerSchema.safeParse({ email: "a@b.co", password: p }).success);
    }
    expect(ok(loginPasswordError(""))).toBe(false);
    expect(ok(loginPasswordError("x"))).toBe(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success);
    expect(ok(loginPasswordError("x".repeat(73)))).toBe(false);
  });
  it("confirm password follows the reset schema", () => {
    for (const [p, c] of [["longenough1", "longenough1"], ["longenough1", "different12"], ["longenough1", ""]] as const) {
      expect(ok(confirmPasswordError(() => p)(c)) && ok(newPasswordError(p))).toBe(resetPasswordSchema.safeParse({ password: p, confirm: c }).success);
    }
  });
  it("name: optional, max 60", () => {
    expect(ok(nameError(""))).toBe(true);
    expect(ok(nameError("x".repeat(60)))).toBe(true);
    expect(ok(nameError("x".repeat(61)))).toBe(false);
    expect(registerSchema.safeParse({ email: "a@b.co", password: "longenough1", fullName: "x".repeat(61) }).success).toBe(false);
  });
  it("destination: same charset/length rule as checkout", () => {
    for (const d of ["", "ab", "081234567890", " 0812-3456 ", "a".repeat(64), "a".repeat(65), "08 123", "0812&x=1", "<script>", "user@host:1", "ok_id.1-2"]) {
      const server = checkoutInputSchema.safeParse({ productId: U, destination: d, idempotencyKey: U }).success;
      expect(ok(destinationError(d)), `destination "${d}"`).toBe(server);
    }
  });
  it("amount: agrees with the top-up schema's bounds (formatted input accepted, empty is never 0)", () => {
    const check = amountError(10_000, 2_000_000);
    expect(ok(check(""))).toBe(false);
    expect(ok(check("abc"))).toBe(false);
    expect(ok(check("0"))).toBe(false);
    expect(ok(check("9.999"))).toBe(false);
    expect(ok(check("10.000"))).toBe(true);
    expect(ok(check("Rp 50 000"))).toBe(true);
    expect(ok(check("2.000.000"))).toBe(true);
    expect(ok(check("2.000.001"))).toBe(false);
    expect(check("5")).toMatch(/minimal/i);
    expect(check("3.000.000")).toMatch(/maksimal/i);
    // whatever the client lets through, the server schema accepts as well-formed input
    for (const v of ["10.000", "50000", "2.000.000"]) expect(createTopupSchema.safeParse({ bank: "BRI", amount: digitsOnly(v), idempotencyKey: U }).success).toBe(true);
  });
});

describe("formatting helpers", () => {
  it("digitsOnly / formatThousands", () => {
    expect(digitsOnly("Rp 50.000,-")).toBe("50000");
    expect(formatThousands("50000")).toBe("50.000");
    expect(formatThousands("")).toBe("");
  });
});

describe("password strength meter (advisory)", () => {
  it("scores sensibly and flags common passwords", () => {
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("abc").label).toBe("Terlalu pendek");
    expect(passwordStrength("password123").label).toBe("Terlalu umum");
    expect(passwordStrength("abcdefgh").score).toBeLessThanOrEqual(2);
    expect(passwordStrength("Tr0ub4dor&3xyz!").score).toBe(4);
    for (const p of ["a", "abcdefgh", "Abcdefgh1", "Abcdefgh1!xyz"]) expect(passwordStrength(p).score).toBeGreaterThanOrEqual(0);
  });
});

describe("e-mail typo suggestion", () => {
  it("fixes close misspellings of popular domains and leaves everything else alone", () => {
    expect(suggestEmail("budi@gmial.com")).toBe("budi@gmail.com");
    expect(suggestEmail("budi@gmail.co")).toBe("budi@gmail.com");
    expect(suggestEmail("budi@yahooo.com")).toBe("budi@yahoo.com");
    expect(suggestEmail("budi@hotmial.com")).toBe("budi@hotmail.com");
    for (const fine of ["budi@gmail.com", "budi@kantor-saya.co.id", "budi@x.io", "tanpa-at", "@gmail.com", ""]) expect(suggestEmail(fine)).toBeNull();
  });
});

describe("landing simulator maths", () => {
  it("total = base + code, and the code stays inside its range", () => {
    expect(simulateTopup(50_000, 372)).toEqual({ base: 50_000, code: 372, total: 50_372 });
    expect(randomCode(1, 999, () => 0)).toBe(1);
    expect(randomCode(1, 999, () => 0.999999)).toBe(999);
    for (let i = 0; i < 500; i++) { const c = randomCode(1, 999); expect(c).toBeGreaterThanOrEqual(1); expect(c).toBeLessThanOrEqual(999); }
  });
});
