import { describe, expect, it, vi } from "vitest";
import { adminAccess, mfaRequired } from "@/lib/admin/mfa-policy";
import { buildDigest, formatAlert, sendAlert } from "@/lib/alerts/notify";
import { changePasswordSchema } from "@/lib/auth/schemas";
import { csvCell, toCsv } from "@/lib/export/csv";
import { jakartaDate, parseExportParams } from "@/lib/export/params";

describe("CSV export", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("true");
  });
  it("neutralises spreadsheet formulas in TEXT cells, but leaves real numbers alone", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) expect(csvCell(evil).replace(/^"/, "").startsWith("'")).toBe(true);
    expect(csvCell(-5000)).toBe("-5000");
    expect(csvCell(12345)).toBe("12345");
    expect(csvCell("2026-10-06T10:00:00Z")).toBe("2026-10-06T10:00:00Z");
    expect(csvCell("0812345678")).toBe("0812345678");
  });
  it("BOM + CRLF + header row", () => {
    const out = toCsv([{ header: "A", get: (r: { a: string }) => r.a }, { header: "B,C", get: () => 1 }], [{ a: "x" }]);
    expect(out.startsWith("\uFEFF")).toBe(true);
    expect(out.split("\r\n")).toEqual(["\uFEFFA,\"B,C\"", "x,1", ""]);
  });
});

describe("export parameters", () => {
  const now = new Date("2026-10-06T10:00:00Z"); // 17:00 WIB on the 6th
  const sp = (q: string) => new URLSearchParams(q);
  it("defaults to the last 30 Jakarta days and treats `to` as inclusive", () => {
    const p = parseExportParams(sp(""), now);
    expect(p).toMatchObject({ ok: true, from: "2026-09-06", to: "2026-10-06" });
    if (p.ok) { expect(p.fromIso).toBe("2026-09-05T17:00:00.000Z"); expect(p.toIso).toBe("2026-10-06T17:00:00.000Z"); }
  });
  it("rejects bad, reversed and over-long ranges", () => {
    for (const q of ["from=06-10-2026", "from=2026-13-40&to=2026-13-41", "from=2026-10-05&to=2026-10-01", "from=2025-01-01&to=2026-10-01"]) {
      expect(parseExportParams(sp(q), now).ok, q).toBe(false);
    }
    expect(parseExportParams(sp("from=2026-01-01&to=2026-12-31"), now).ok).toBe(true);
  });
  it("only whitelisted filter values pass through", () => {
    expect(parseExportParams(sp("status=FAILED&type=REFUND"), now)).toMatchObject({ ok: true, status: "FAILED", type: "REFUND" });
    expect(parseExportParams(sp("status=DROP&type=x"), now)).toMatchObject({ ok: true, status: undefined, type: undefined });
  });
  it("jakartaDate follows UTC+7", () => {
    expect(jakartaDate(0, new Date("2026-10-06T18:00:00Z"))).toBe("2026-10-07");
    expect(jakartaDate(1, new Date("2026-10-06T10:00:00Z"))).toBe("2026-10-05");
  });
});

describe("admin MFA policy", () => {
  it("only an admin can ever pass; MFA needs aal2 unless explicitly switched off", () => {
    expect(adminAccess({ isAdmin: false, aal: "aal2", required: true })).toBe("DENY");
    expect(adminAccess({ isAdmin: false, aal: "aal2", required: false })).toBe("DENY");
    expect(adminAccess({ isAdmin: true, aal: "aal2", required: true })).toBe("OK");
    expect(adminAccess({ isAdmin: true, aal: "aal1", required: true })).toBe("NEEDS_MFA");
    expect(adminAccess({ isAdmin: true, aal: null, required: true })).toBe("NEEDS_MFA");
    expect(adminAccess({ isAdmin: true, aal: "aal1", required: false })).toBe("OK");
  });
  it("MFA is required by default; only the exact string 'false' turns it off", () => {
    expect(mfaRequired({})).toBe(true);
    expect(mfaRequired({ ADMIN_MFA_REQUIRED: "true" })).toBe(true);
    expect(mfaRequired({ ADMIN_MFA_REQUIRED: "0" })).toBe(true);
    expect(mfaRequired({ ADMIN_MFA_REQUIRED: "false" })).toBe(false);
  });
});

describe("alerts", () => {
  it("formats plain text, strips control characters and caps the length", () => {
    const t = formatAlert({ severity: "critical", title: "Judul\u0007", lines: ["a\u0000b", "x".repeat(5000)] });
    expect(t.startsWith("[PENTING] Judul")).toBe(true);
    expect(t).not.toMatch(/[\u0000-\u0008]/);
    expect(t.length).toBeLessThanOrEqual(3500);
  });
  it("does nothing (and never calls the network) when the bot is not configured", async () => {
    const fetchImpl = vi.fn();
    expect(await sendAlert({ severity: "info", title: "x" }, { fetchImpl: fetchImpl as unknown as typeof fetch, token: "", chatId: "" })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("posts to Telegram with the chat id and the text", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await sendAlert({ severity: "warn", title: "Tes", lines: ["satu"] }, { fetchImpl: fetchImpl as unknown as typeof fetch, token: "123:ABC", chatId: "42" })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123:ABC/sendMessage");
    expect(JSON.parse(init.body as string)).toMatchObject({ chat_id: "42", disable_web_page_preview: true });
    expect(JSON.parse(init.body as string).text).toContain("[PERHATIAN] Tes");
  });
  it("never throws and never logs the bot token, on HTTP errors, network errors and timeouts", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secret = "999:SECRET-TOKEN";
    const bad = vi.fn(async () => new Response("no", { status: 401 }));
    const boom = vi.fn(async () => { throw new TypeError(`fetch failed https://api.telegram.org/bot${secret}/sendMessage`); });
    const hang = vi.fn((_u: unknown, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" })))));
    for (const f of [bad, boom, hang]) {
      expect(await sendAlert({ severity: "info", title: "x" }, { fetchImpl: f as unknown as typeof fetch, token: secret, chatId: "1", timeoutMs: 30 })).toBe(false);
    }
    expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRET-TOKEN");
    spy.mockRestore();
  });
  it("digest: critical when a human is needed now, warn when work is queued, info otherwise", () => {
    const base = { since_pending: 1, since_success: 5, since_failed: 0, since_revenue: 100000, unsent: 0, stale_pending: 0, needs_review: 0, topup_queued: 0, topup_pending: 0, webhook_unresolved_24h: 0 };
    expect(buildDigest(base).severity).toBe("info");
    expect(buildDigest({ ...base, topup_queued: 2 }).severity).toBe("warn");
    expect(buildDigest({ ...base, stale_pending: 1 }).severity).toBe("critical");
    expect(buildDigest({ ...base, needs_review: 1 }).lines?.join(" ")).toContain("ditandai review");
    expect(buildDigest(base).lines?.[0]).toContain("5 berhasil");
  });
});

describe("change password schema", () => {
  const ok = { current: "oldpassword1", password: "newpassword2", confirm: "newpassword2" };
  it("needs the current password, 8..72 chars, matching confirmation and a different password", () => {
    expect(changePasswordSchema.safeParse(ok).success).toBe(true);
    expect(changePasswordSchema.safeParse({ ...ok, current: "" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...ok, password: "short", confirm: "short" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...ok, confirm: "different12" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...ok, password: "oldpassword1", confirm: "oldpassword1" }).success).toBe(false);
  });
});
