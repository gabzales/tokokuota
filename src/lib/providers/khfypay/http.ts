import type { RawProviderResponse, TransportFailure } from "../types";

export type FetchResult = { kind: "response"; raw: RawProviderResponse } | TransportFailure;

export interface HttpOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * GET with a hard timeout. It never throws and never echoes the URL (it contains the API key).
 * A timeout / network error / non-2xx is reported as a transport problem, NOT as a business
 * failure: the provider may still have processed the request.
 */
export async function fetchRaw(url: string, opts: HttpOptions): Promise<FetchResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await doFetch(url, {
      method: "GET",
      signal: ctrl.signal,
      cache: "no-store",
      headers: { accept: "application/json, text/plain, */*" },
    });
    const bodyText = await res.text(); // body read is inside the same timeout window

    if (!res.ok) return { kind: "transport_error", reason: "http_error", httpStatus: res.status };

    let json: unknown;
    try {
      json = JSON.parse(bodyText);
    } catch {
      json = undefined;
    }
    return {
      kind: "response",
      raw: { httpStatus: res.status, contentType: res.headers.get("content-type"), bodyText, json },
    };
  } catch (err) {
    const aborted = ctrl.signal.aborted || (err instanceof Error && err.name === "AbortError");
    return { kind: "transport_error", reason: aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
