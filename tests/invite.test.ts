import { describe, expect, it, vi } from "vitest";
import { INVITE_CODE_RE, inviteCodeError, normalizeInviteCode } from "@/lib/invite";
import { createInviteRpc } from "@/lib/invite-rpc";
import { inviteCreateSchema, inviteRevokeSchema } from "@/lib/admin/schemas";
import type { RpcCaller } from "@/lib/transactions/rpc";

describe("invite code format", () => {
  it("accepts the canonical form and forgives case, spaces and missing dashes (pasted from WhatsApp)", () => {
    for (const v of ["TK-1A2B-3C4D-5E6F", " tk-1a2b-3c4d-5e6f ", "TK1A2B3C4D5E6F", "tk 1a2b 3c4d 5e6f"]) {
      expect(normalizeInviteCode(v)).toBe("TK-1A2B-3C4D-5E6F");
      expect(inviteCodeError(v)).toBeNull();
    }
    expect(INVITE_CODE_RE.test("TK-1A2B-3C4D-5E6F")).toBe(true);
  });
  it("rejects empty, wrong length, non-hex and other prefixes", () => {
    expect(inviteCodeError("")).toMatch(/wajib/i);
    for (const v of ["TK-1A2B-3C4D", "TK-1A2B-3C4D-5E6G", "XX-1A2B-3C4D-5E6F", "TK-1A2B-3C4D-5E6F-7", "' or 1=1 --"]) expect(inviteCodeError(v)).not.toBeNull();
  });
});

describe("admin invite schemas", () => {
  it("validDays must be a whole number of days from 1 to 90; an empty field is an error, not 0", () => {
    expect(inviteCreateSchema.parse({ note: " Budi ", validDays: "7" })).toEqual({ note: "Budi", validDays: 7 });
    for (const v of ["", "0", "91", "1.5", "abc"]) expect(inviteCreateSchema.safeParse({ note: "", validDays: v }).success, v).toBe(false);
    expect(inviteCreateSchema.safeParse({ note: "x".repeat(101), validDays: "7" }).success).toBe(false);
  });
  it("revoke needs a uuid", () => {
    expect(inviteRevokeSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    expect(inviteRevokeSchema.safeParse({ id: "7b6f3b0e-3c52-4b52-9f0e-1b2c3d4e5f60" }).success).toBe(true);
  });
});

describe("invite rpc wrapper", () => {
  const caller = (data: unknown, error: { message: string; code?: string } | null = null) => ({ rpc: vi.fn(async () => ({ data, error })) }) satisfies RpcCaller;

  it("isValid is true only for a literal true", async () => {
    expect(await createInviteRpc(caller(true)).isValid("TK-1A2B-3C4D-5E6F")).toBe(true);
    for (const d of [false, null, "true", 1, [true]]) expect(await createInviteRpc(caller(d)).isValid("x")).toBe(false);
  });
  it("create maps the row and passes the admin id (the DB re-checks admin)", async () => {
    const c = caller([{ out_id: "i1", out_code: "TK-1A2B-3C4D-5E6F", out_expires_at: "2026-10-18T00:00:00Z" }]);
    const r = await createInviteRpc(c).create({ adminId: "a1", note: "Budi", validDays: 7 });
    expect(r).toEqual({ id: "i1", code: "TK-1A2B-3C4D-5E6F", expiresAt: "2026-10-18T00:00:00.000Z" });
    expect(c.rpc).toHaveBeenCalledWith("admin_create_invite_code", { p_admin_id: "a1", p_note: "Budi", p_valid_days: 7 });
  });
  it("an unexpected response shape or a database error throws instead of pretending success", async () => {
    await expect(createInviteRpc(caller([{ nope: 1 }])).create({ adminId: "a", note: "", validDays: 7 })).rejects.toThrow(/unexpected response shape/);
    await expect(createInviteRpc(caller(null, { message: "boom", code: "42501" })).revoke({ adminId: "a", id: "i" })).rejects.toThrow(/boom/);
    await expect(createInviteRpc(caller([{ out_outcome: "WHATEVER" }])).revoke({ adminId: "a", id: "i" })).rejects.toThrow();
  });
});
