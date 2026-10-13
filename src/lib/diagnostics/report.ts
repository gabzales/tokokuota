import type { DiagResult } from "./types";

const ICON = { pass: "[PASS]", warn: "[WARN]", fail: "[FAIL]", skip: "[SKIP]" } as const;

/** Plain-text report for copy-paste into a chat. Inputs are already redacted. */
export function formatReport(results: readonly DiagResult[], meta: { generatedAt: string; site?: string | null }): string {
  const lines: string[] = [`Laporan diagnostik Toko Kuota`, `Waktu: ${meta.generatedAt}`];
  if (meta.site) lines.push(`Situs: ${meta.site}`);
  for (const r of results) {
    lines.push("", `${ICON[r.status]} ${r.title}`, `  kode: ${r.code}`, `  ${r.summary}`);
    if (r.httpStatus !== undefined) lines.push(`  HTTP: ${r.httpStatus}`);
    if (r.latencyMs !== undefined) lines.push(`  waktu: ${r.latencyMs} ms`);
    if (r.hint) lines.push(`  saran: ${r.hint}`);
    if (r.detail) lines.push("  detail:", ...r.detail.split("\n").map((l) => `    ${l}`));
  }
  return lines.join("\n");
}
