export type Cell = string | number | boolean | null | undefined;
export interface Column<T> { header: string; get: (row: T) => Cell }

// A text cell that starts with = + - @ (or a tab/CR) is executed as a FORMULA by Excel / Sheets.
// Fields such as destination, note and product name are user-influenced, so they are neutralised.
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && FORMULA.test(s)) s = `'${s}`; // real numbers (even negative) are never prefixed
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 BOM (so Excel reads Indonesian text correctly) + CRLF line endings. */
export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(","), ...rows.map((r) => columns.map((c) => csvCell(c.get(r))).join(","))];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
