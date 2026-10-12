import type { ProviderResultStatus } from "../types";

/**
 * Documented: result=0 => success, result=1 => failed/cancelled.
 * Anything else (including missing) is UNKNOWN and must leave the transaction PENDING.
 */
export function mapProviderResult(result: unknown): ProviderResultStatus {
  const s = typeof result === "number" ? String(result) : typeof result === "string" ? result.trim() : "";
  if (s === "0") return "SUCCESS";
  if (s === "1") return "FAILED";
  return "UNKNOWN";
}
