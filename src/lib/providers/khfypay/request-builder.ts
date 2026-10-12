import type { CreateTransactionInput, HistoryQuery } from "../types";
import { ProviderNotConfiguredError } from "./errors";
import { KHFYPAY_ENDPOINTS, type KhfyPayEndpoint, type KhfyPayWire } from "./wire";

export interface KhfyPayConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export interface BuiltRequest {
  /** Contains the API key. Pass to fetch only; NEVER log it. */
  url: string;
  /** Same URL with the key masked. Safe for logs and error reports. */
  redactedUrl: string;
}

type Param = { label: string; wireName: string | null; value: string | undefined };

function assertSafeBase(baseUrl: string): URL {
  const u = new URL(baseUrl);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !local) {
    throw new Error("KHFYPAY_BASE_URL must be https (the API key travels in the request)");
  }
  return u;
}

function build(cfg: KhfyPayConfig, wire: KhfyPayWire, endpoint: KhfyPayEndpoint, params: Param[]): BuiltRequest {
  const missing: string[] = [];
  const withKey = wire.authenticated[endpoint];
  if (withKey && !wire.apiKey) missing.push("apiKey parameter name");
  for (const p of params) {
    if (p.value !== undefined && !p.wireName) missing.push(`${endpoint}.${p.label} parameter name`);
  }
  if (missing.length > 0) throw new ProviderNotConfiguredError(missing);

  const base = assertSafeBase(cfg.baseUrl);
  // Endpoints are relative to the base URL path (KHFYPAY_BASE_URL=https://panel.khfy-store.com/api_v2), except the
  // ones that carry their own version prefix (/api_v3/...), which are absolute from the host.
  const ep: string = KHFYPAY_ENDPOINTS[endpoint];
  const path = /^\/api_v\d+\//.test(ep) ? ep : `${base.pathname.replace(/\/+$/, "")}${ep}`;
  const url = new URL(path, base.origin);

  if (withKey) url.searchParams.set(wire.apiKey as string, cfg.apiKey);
  for (const p of params) {
    if (p.value !== undefined && p.wireName) url.searchParams.set(p.wireName, p.value);
  }

  const redacted = new URL(url.toString());
  if (withKey) redacted.searchParams.set(wire.apiKey as string, "***");
  return { url: url.toString(), redactedUrl: redacted.toString() };
}

export const buildListProductRequest = (cfg: KhfyPayConfig, wire: KhfyPayWire) =>
  build(cfg, wire, "listProduct", []);

export const buildCekStockAkrabRequest = (cfg: KhfyPayConfig, wire: KhfyPayWire) =>
  build(cfg, wire, "cekStockAkrab", []);

export const buildTrxRequest = (cfg: KhfyPayConfig, wire: KhfyPayWire, input: CreateTransactionInput) =>
  build(cfg, wire, "trx", [
    { label: "reffId", wireName: wire.trx.reffId, value: input.reffId },
    { label: "productCode", wireName: wire.trx.productCode, value: input.productCode },
    { label: "destination", wireName: wire.trx.destination, value: input.destination },
  ]);

export const buildHistoryRequest = (cfg: KhfyPayConfig, wire: KhfyPayWire, query: HistoryQuery) =>
  build(cfg, wire, "history", [{ label: "reffId", wireName: wire.history.reffId, value: query.reffId }]);

/** Dry-run: proves the trx request can be built, using throw-away values. Sends nothing. */
export function assertTrxRequestBuildable(cfg: KhfyPayConfig, wire: KhfyPayWire): void {
  buildTrxRequest(cfg, wire, { reffId: "TKDRYRUN", productCode: "DRYRUN", destination: "0000000000" });
}
