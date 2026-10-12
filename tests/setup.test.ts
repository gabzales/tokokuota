import { describe, expect, it, vi } from "vitest";
import { createSetupRpc, setupSchema } from "@/lib/setup";
import type { RpcCaller } from "@/lib/transactions/rpc";

describe("setupSchema", () => {
  const ok = { secret: "s", email: " Owner@Gmail.com ", password: "longenough1", confirm: "longenough1" };
  it("normalises the e-mail and accepts a good form", () => {
    expect(setupSchema.parse(ok).email).toBe("owner@gmail.com");
  });
  it("rejects a missing secret, bad e-mail, short/long password and a mismatched confirmation", () => {
    for (const bad of [{ secret: "" }, { email: "nope" }, { password: "short", confirm: "short" }, { password: "x".repeat(73), confirm: "x".repeat(73) }, { confirm: "different1" }]) {
      expect(setupSchema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("setup rpc wrapper", () => {
  const caller = (data: unknown, error: { message: string; code?: string } | null = null) => ({ rpc: vi.fn(async () => ({ data, error })) }) satisfies RpcCaller;
  it("isNeeded / promote are true only for a literal true", async () => {
    expect(await createSetupRpc(caller(true)).isNeeded()).toBe(true);
    expect(await createSetupRpc(caller(true)).promote("u")).toBe(true);
    for (const d of [false, null, "true", 1, [true]]) {
      expect(await createSetupRpc(caller(d)).isNeeded()).toBe(false);
      expect(await createSetupRpc(caller(d)).promote("u")).toBe(false);
    }
  });
  it("issueInvite returns the code, or null when setup is closed", async () => {
    expect(await createSetupRpc(caller("TK-1A2B-3C4D-5E6F")).issueInvite()).toBe("TK-1A2B-3C4D-5E6F");
    for (const d of [null, "", 0, false]) expect(await createSetupRpc(caller(d)).issueInvite()).toBeNull();
  });
  it("a database error is thrown, never read as 'not needed'", async () => {
    await expect(createSetupRpc(caller(null, { message: "boom", code: "42883" })).isNeeded()).rejects.toThrow(/boom/);
  });
});
