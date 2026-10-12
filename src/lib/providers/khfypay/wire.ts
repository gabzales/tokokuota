// KhfyPay wire format. Anything still unconfirmed stays `null`/flagged here, and the request
// builder refuses to send a request that needs it instead of guessing.

/** Documented endpoints (all GET). */
export const KHFYPAY_ENDPOINTS = {
  listProduct: "/list_product",
  trx: "/trx",
  history: "/history",
  cekStockAkrab: "/api_v3/cek_stock_akrab",
} as const;

export type KhfyPayEndpoint = keyof typeof KHFYPAY_ENDPOINTS;

export interface KhfyPayWire {
  /** Query-parameter name carrying the API key. */
  apiKey: string | null;
  /** Endpoints that receive the API key. */
  authenticated: Record<KhfyPayEndpoint, boolean>;
  trx: { reffId: string | null; productCode: string | null; destination: string | null };
  history: { reffId: string | null };
}

export const KHFYPAY_WIRE: KhfyPayWire = {
  // Documented: /trx => produk, tujuan, reff_id, api_key ; /history => refid, api_key
  apiKey: "api_key",
  authenticated: {
    trx: true,
    history: true,
    listProduct: true, // confirmed: /list_product uses api_key
    // The available documentation for /api_v3/cek_stock_akrab does NOT list api_key, so none is sent.
    cekStockAkrab: false,
  },
  trx: { reffId: "reff_id", productCode: "produk", destination: "tujuan" },
  // /history is a lookup by `refid` only. No date range / pagination (not documented).
  history: { reffId: "refid" },
};
