export type Severity = "info" | "warn" | "critical";
export interface Alert { severity: Severity; title: string; lines?: string[] }
export interface AlertDeps { fetchImpl?: typeof fetch; token?: string; chatId?: string; timeoutMs?: number }

const TAG: Record<Severity, string> = { info: "INFO", warn: "PERHATIAN", critical: "PENTING" };

/** Plain text (no markup): control characters removed, length capped for Telegram's 4096 limit. */
export function formatAlert(a: Alert): string {
  const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim();
  const text = [`[${TAG[a.severity]}] ${clean(a.title)}`, ...(a.lines ?? []).map((l) => `• ${clean(l)}`)].join("\n");
  return text.length > 3500 ? `${text.slice(0, 3490)}…` : text;
}

/**
 * Sends one Telegram message. Best effort by design: it NEVER throws, does nothing when the bot is not
 * configured, gives up after a few seconds, and never logs the bot token (the token is part of the URL,
 * so errors are reported without it).
 */
export async function sendAlert(a: Alert, deps: AlertDeps = {}): Promise<boolean> {
  const token = deps.token ?? process.env.TELEGRAM_BOT_TOKEN;
  const chatId = deps.chatId ?? process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 4000);
  try {
    const res = await (deps.fetchImpl ?? fetch)(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: formatAlert(a), disable_web_page_preview: true }),
      signal: ctrl.signal,
    });
    if (!res.ok) console.error(`alert not delivered (HTTP ${res.status})`);
    return res.ok;
  } catch (e) {
    console.error(`alert not delivered (${e instanceof Error ? e.name : "error"})`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface DigestStats {
  since_pending: number; since_success: number; since_failed: number; since_revenue: number;
  unsent: number; stale_pending: number; needs_review: number; topup_queued: number; topup_pending: number; webhook_unresolved_24h: number;
}

/** Daily summary: critical if something needs a human now, warn if work is queued, info otherwise. */
export function buildDigest(s: DigestStats): Alert {
  const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
  const lines = [
    `Hari ini: ${s.since_success} berhasil, ${s.since_pending} diproses, ${s.since_failed} gagal (omzet berhasil ${rp(s.since_revenue)})`,
  ];
  const attention: [number, string][] = [
    [s.needs_review, "transaksi ditandai review"],
    [s.stale_pending, "transaksi PENDING lebih dari 10 menit"],
    [s.unsent, "transaksi belum terkirim ke provider"],
    [s.topup_queued, "transfer top-up perlu dicek"],
    [s.webhook_unresolved_24h, "webhook belum terselesaikan (24 jam)"],
  ];
  for (const [n, label] of attention) if (n > 0) lines.push(`${n} ${label}`);
  if (s.topup_pending > 0) lines.push(`${s.topup_pending} permintaan top-up menunggu bayar`);
  const critical = s.needs_review > 0 || s.stale_pending > 0;
  const warn = attention.some(([n]) => n > 0);
  return { severity: critical ? "critical" : warn ? "warn" : "info", title: "Ringkasan harian Toko Kuota", lines };
}
