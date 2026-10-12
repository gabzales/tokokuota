import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerEnv, supabaseEnv } from "@/lib/env/server";
import { createAdminClient } from "@/lib/supabase/admin";

const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "KHFYPAY_BASE_URL", "KHFYPAY_API_KEY", "KHFYPAY_TIMEOUT_MS"] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); KEYS.forEach((k) => delete process.env[k]); });
afterEach(() => { KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

const setSupabase = () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "s".repeat(40);
};

describe("environment groups are independent", () => {
  it("the app's Supabase access works WITHOUT any provider variable", () => {
    setSupabase();
    expect(() => supabaseEnv()).not.toThrow();
    expect(() => createAdminClient()).not.toThrow();
    expect(() => providerEnv()).toThrow(/KHFYPAY_BASE_URL.*KHFYPAY_API_KEY/);
  });
  it("provider variables are validated when (and only when) the provider is used", () => {
    process.env.KHFYPAY_BASE_URL = "https://provider.example";
    process.env.KHFYPAY_API_KEY = "k";
    expect(providerEnv()).toMatchObject({ KHFYPAY_TIMEOUT_MS: 15000 });
    process.env.KHFYPAY_BASE_URL = "not a url";
    expect(() => providerEnv()).toThrow(/KHFYPAY_BASE_URL/);
  });
  it("missing Supabase variables are named; values never appear in the message", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "too-short-secret";
    let msg = "";
    try { supabaseEnv(); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(msg).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(msg).not.toContain("too-short-secret");
  });
});
