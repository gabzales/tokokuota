import type {
  CreateTransactionInput,
  HistoryQuery,
  ProviderAdapter,
  ProviderCall,
  ProviderHistoryEntry,
  ProviderProduct,
  RawProviderResponse,
  SubmitOutcome,
} from "../types";
import { fetchRaw, type FetchResult } from "./http";
import { parseHistoryResponse, parseListProductResponse, parseTrxResponse } from "./parsers";
import {
  assertTrxRequestBuildable,
  buildCekStockAkrabRequest,
  buildHistoryRequest,
  buildListProductRequest,
  buildTrxRequest,
  type BuiltRequest,
  type KhfyPayConfig,
} from "./request-builder";
import { KHFYPAY_WIRE, type KhfyPayWire } from "./wire";

export interface KhfyPayDeps {
  fetchImpl?: typeof fetch;
  wire?: KhfyPayWire;
}

export class KhfyPayAdapter implements ProviderAdapter {
  readonly id = "khfypay";
  private readonly wire: KhfyPayWire;

  constructor(
    private readonly cfg: KhfyPayConfig,
    private readonly deps: KhfyPayDeps = {},
  ) {
    this.wire = deps.wire ?? KHFYPAY_WIRE;
  }

  assertReady(): void {
    assertTrxRequestBuildable(this.cfg, this.wire);
  }

  private send(req: BuiltRequest): Promise<FetchResult> {
    return fetchRaw(req.url, { timeoutMs: this.cfg.timeoutMs, fetchImpl: this.deps.fetchImpl });
  }

  private map<T>(
    res: FetchResult,
    parse: (raw: RawProviderResponse) => T | null,
  ): ProviderCall<T> {
    if (res.kind === "transport_error") return res;
    const data = parse(res.raw);
    return data === null ? { kind: "unparsed", raw: res.raw } : { kind: "ok", data, raw: res.raw };
  }

  async listProducts(): Promise<ProviderCall<ProviderProduct[]>> {
    const res = await this.send(buildListProductRequest(this.cfg, this.wire));
    return this.map(res, parseListProductResponse);
  }

  async createTransaction(input: CreateTransactionInput): Promise<SubmitOutcome> {
    const res = await this.send(buildTrxRequest(this.cfg, this.wire, input));
    if (res.kind === "transport_error") {
      // timeout / network / non-2xx: outcome unknown, the provider may have accepted it.
      return { kind: "transport_uncertain", reason: res.reason, httpStatus: res.httpStatus };
    }
    return { kind: "response", raw: res.raw, parsed: parseTrxResponse(res.raw) };
  }

  async getHistory(query: HistoryQuery): Promise<ProviderCall<ProviderHistoryEntry[]>> {
    const res = await this.send(buildHistoryRequest(this.cfg, this.wire, query));
    return this.map(res, parseHistoryResponse);
  }

  async checkAkrabStock(): Promise<ProviderCall<unknown>> {
    const res = await this.send(buildCekStockAkrabRequest(this.cfg, this.wire));
    // No normalized shape defined yet: hand back the raw body.
    return res.kind === "transport_error" ? res : { kind: "ok", data: res.raw.json ?? res.raw.bodyText, raw: res.raw };
  }
}
