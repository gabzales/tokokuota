/** Replaces every occurrence of each secret, then truncates. For anything stored or logged. */
export function redactAndTruncate(text: string, secrets: readonly string[], maxLen = 4096): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join("***");
  }
  return out.length > maxLen ? `${out.slice(0, maxLen)}…[truncated]` : out;
}
