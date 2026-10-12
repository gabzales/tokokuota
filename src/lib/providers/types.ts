// Provider-agnostic boundary. Application/business code depends ONLY on this file,
// so a second provider (or the real KhfyPay JSON mapping) never touches checkout logic.

export type ProviderResultStatus = "SUCCESS" | "FAILED" | "UNKNOWN";

/** What actually came back over HTTP, kept verbatim so nothing is lost while parsers are TODO. */
export interface RawProviderResponse {
  httpStatus: number;
  contentType: string | null;
  bodyText: string;
  /** Parsed JSON body, or undefined when the body is not JSON. */
  json: unknown;
}

export type TransportFailureReason = "timeout" | "network" | "http_error";

export interface TransportFailure {
  kind: "transport_error";
  reason: TransportFailureReason;
  httpStatus?: number;
}

/**
 * Result of a provider call.
 *  - ok:        response received AND mapped to our normalized type
 *  - unparsed:  response received, mapping not implemented yet / did not match (raw preserved)
 *  - transport_error: no usable response (timeout, network, non-2xx)
 */
export type ProviderCall<T> =
  | { kind: "ok"; data: T; raw: RawProviderResponse }
  | { kind: "unparsed"; raw: RawProviderResponse }
  | TransportFailure;

export interface ProviderProduct {
  providerCode: string;
  name: string;
  category: string | null;
  costPrice: number; // integer rupiah
  isAvailable: boolean;
  raw: unknown;
}

export interface CreateTransactionInput {
  /** Generated once by the database; identical on every retry of the same purchase. */
  reffId: string;
  productCode: string;
  destination: string;
}

export interface ParsedTrxResponse {
  status: ProviderResultStatus;
  message: string | null;
}

export type SubmitOutcome =
  /** No usable answer. The provider may or may not have processed it => NEVER a failure. */
  | { kind: "transport_uncertain"; reason: TransportFailureReason; httpStatus?: number }
  /** An HTTP answer arrived. `parsed` is null until the real /trx sample is mapped. */
  | { kind: "response"; raw: RawProviderResponse; parsed: ParsedTrxResponse | null };

/** Status lookup of ONE transaction by the reff_id we sent (provider param: `refid`). */
export interface HistoryQuery {
  reffId: string;
}

export interface ProviderHistoryEntry {
  reffId: string;
  status: ProviderResultStatus;
  message: string | null;
  raw: unknown;
}

export interface ProviderAdapter {
  readonly id: string;
  /**
   * Throws if a request cannot even be BUILT (missing config / wire details). Called before any
   * money moves, so a configuration problem can never leave a user charged for a request that
   * was never sent.
   */
  assertReady(): void;
  listProducts(): Promise<ProviderCall<ProviderProduct[]>>;
  createTransaction(input: CreateTransactionInput): Promise<SubmitOutcome>;
  getHistory(query: HistoryQuery): Promise<ProviderCall<ProviderHistoryEntry[]>>;
  checkAkrabStock(): Promise<ProviderCall<unknown>>;
}
