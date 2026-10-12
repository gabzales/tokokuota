import type {
  ParsedTrxResponse,
  ProviderHistoryEntry,
  ProviderProduct,
  RawProviderResponse,
} from "../types";

// ---------------------------------------------------------------------------
// RESPONSE PARSERS — intentionally NOT implemented.
//
// The real JSON of /list_product, /trx and /history has not been provided, and inventing
// field names would put wrong prices/statuses next to real money. Until samples exist every
// parser returns null, the adapter reports `unparsed`, and the raw response is preserved.
//
// To finish: add the real sample under tests/fixtures/, implement the parser against it,
// and add a test that feeds the fixture through the adapter.
// ---------------------------------------------------------------------------

/** TODO(sample): map the /list_product body to ProviderProduct[]. */
export function parseListProductResponse(_raw: RawProviderResponse): ProviderProduct[] | null {
  return null;
}

/** TODO(sample): map the /trx body to a status (use mapProviderResult on the real result field). */
export function parseTrxResponse(_raw: RawProviderResponse): ParsedTrxResponse | null {
  return null;
}

/** TODO(sample): map the /history body to ProviderHistoryEntry[]. */
export function parseHistoryResponse(_raw: RawProviderResponse): ProviderHistoryEntry[] | null {
  return null;
}
