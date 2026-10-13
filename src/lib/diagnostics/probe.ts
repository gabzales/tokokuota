import { redactAndTruncate } from "@/lib/security/redact";

export type ProbeCode =
  | "OK" | "NET_TIMEOUT" | "NET_DNS" | "NET_REFUSED" | "NET_RESET" | "NET_TLS" | "NET_UNKNOWN"
  | "HTTP_REDIRECT" | "HTTP_401" | "HTTP_403" | "HTTP_404" | "HTTP_429" | "HTTP_4XX" | "HTTP_5XX";

export interface ProbeResult {
  code: ProbeCode;
  httpStatus?: number;
  latencyMs: number;
  contentType?: string | null;
  server?: string | null;
  location?: string | null;
  /** Redacted + truncated body, safe to show. */
  body?: string;
  bodyTruncated?: boolean;
  /** Parsed body (server side only: never copied into a DiagResult). */
  json?: unknown;
  errName?: string;
  errMessage?: string;
  errCause?: string;
}

export interface ProbeOptions {
  timeoutMs: number;
  /** Values that must never appear in the output (API keys, secrets). */
  secrets: readonly string[];
  maxBody?: number;
  fetchImpl?: typeof fetch;
}

export function classifyHttpStatus(status: number): ProbeCode {
  if (status >= 200 && status < 300) return "OK";
  if (status >= 300 && status < 400) return "HTTP_REDIRECT";
  if (status === 401) return "HTTP_401";
  if (status === 403) return "HTTP_403";
  if (status === 404) return "HTTP_404";
  if (status === 429) return "HTTP_429";
  if (status >= 400 && status < 500) return "HTTP_4XX";
  return "HTTP_5XX";
}

type ErrLike = { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };

/** Node's fetch hides the real reason in `err.cause.code` (ENOTFOUND, ECONNREFUSED, CERT_…). */
export function classifyNetworkError(err: unknown, aborted: boolean): { code: ProbeCode; name?: string; message?: string; cause?: string } {
  const e = (err ?? {}) as ErrLike;
  const cause = (e.cause ?? {}) as ErrLike;
  const raw = String(cause.code ?? e.code ?? "");
  const name = typeof e.name === "string" ? e.name : undefined;
  const message = typeof e.message === "string" ? e.message : undefined;
  const causeText = [raw, typeof cause.message === "string" ? cause.message : ""].filter(Boolean).join(" ");
  let code: ProbeCode = "NET_UNKNOWN";
  if (aborted || name === "AbortError" || raw === "UND_ERR_CONNECT_TIMEOUT" || raw === "ETIMEDOUT" || raw === "UND_ERR_HEADERS_TIMEOUT" || raw === "UND_ERR_BODY_TIMEOUT") code = "NET_TIMEOUT";
  else if (raw === "ENOTFOUND" || raw === "EAI_AGAIN" || raw === "EAI_NODATA") code = "NET_DNS";
  else if (raw === "ECONNREFUSED") code = "NET_REFUSED";
  else if (raw === "ECONNRESET" || raw === "EPIPE" || raw === "UND_ERR_SOCKET") code = "NET_RESET";
  else if (/^(CERT_|ERR_TLS|DEPTH_ZERO|UNABLE_TO_|SELF_SIGNED|ERR_SSL)/.test(raw) || /certificate|tls|ssl/i.test(causeText)) code = "NET_TLS";
  return { code, name, message, cause: causeText || undefined };
}

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * One GET with a hard timeout that NEVER throws and keeps everything an engineer needs to diagnose a failure:
 * HTTP status (also for 4xx/5xx, unlike the production client), latency, headers that identify a WAF, body, and the real network error cause.
 * Redirects are NOT followed (a redirect is a finding). All output is redacted with `secrets`.
 */
export async function probeHttp(url: string, opts: ProbeOptions): Promise<ProbeResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxBody = opts.maxBody ?? 4000;
  const red = (s: string, max = 1000) => redactAndTruncate(s, opts.secrets, max);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  const t0 = Date.now();
  try {
    const res = await doFetch(url, { method: "GET", redirect: "manual", signal: ctrl.signal, cache: "no-store", headers: { accept: "application/json, text/plain, */*" } });
    const text = await res.text();
    const loc = res.headers.get("location");
    return {
      code: classifyHttpStatus(res.status),
      httpStatus: res.status,
      latencyMs: Date.now() - t0,
      contentType: res.headers.get("content-type"),
      server: res.headers.get("server"),
      location: loc ? red(loc, 300) : null,
      body: red(text, maxBody),
      bodyTruncated: text.length > maxBody,
      json: jsonOf(text),
    };
  } catch (err) {
    const aborted = ctrl.signal.aborted;
    const c = classifyNetworkError(err, aborted);
    return {
      code: c.code,
      latencyMs: Date.now() - t0,
      errName: c.name,
      errMessage: c.message ? red(c.message, 300) : undefined,
      errCause: c.cause ? red(c.cause, 300) : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}
