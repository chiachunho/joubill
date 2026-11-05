/**
 * CSV building for the group export. Pure, so the escaping rules are
 * unit-tested: a wrong quote or a missing BOM doesn't throw, it just opens as
 * garbage (or as a live formula) in the user's spreadsheet.
 */

/** Excel assumes a legacy codepage for CSV unless the file starts with a UTF-8 BOM. */
const BOM = "﻿";

/** A leading one of these makes Excel / Sheets evaluate the cell as a formula. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * One cell. Free text is user-controlled (an expense description of `=HYPERLINK(…)`
 * would run in the viewer's spreadsheet), so a formula-looking value gets a `'`
 * prefix. Only pass text through `escapeCsvField`; numbers go in via `String()`
 * so a negative amount isn't mistaken for a formula.
 */
export function escapeCsvField(value: string): string {
  return rawField(FORMULA_TRIGGER.test(value) ? `'${value}` : value);
}

/** Quoting only, no formula guard: for a cell already known to be a plain number or timestamp. */
function rawField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A column value: text is guarded, numbers are written as-is. */
export type CsvCell = string | number | null;

function cellToField(cell: CsvCell): string {
  if (cell === null) return "";
  return typeof cell === "number" ? rawField(String(cell)) : escapeCsvField(cell);
}

/** BOM + header + rows, CRLF-separated (what Excel expects) with a trailing newline. */
export function buildCsv(header: readonly string[], rows: readonly CsvCell[][]): string {
  const lines = [header.map((h) => escapeCsvField(h)), ...rows.map((r) => r.map(cellToField))];
  return BOM + lines.map((l) => l.join(",")).join("\r\n") + "\r\n";
}

/** `A:300; B:200` — one entry per person, so a multi-payer record stays on one row. */
export function formatLegs(legs: readonly { name: string; amount: number }[]): string {
  return legs.map((l) => `${l.name}:${formatAmount(l.amount)}`).join("; ");
}

function formatAmount(amount: number): string {
  const s = amount.toFixed(2);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

/** `2026-10-29 14:05` in UTC. The schema holds no group timezone, so the header says UTC. */
export function formatUtcMinute(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * `<group>-<YYYY-MM-DD>.csv`. Characters that are illegal in filenames (or that
 * would break the Content-Disposition header) become `_`.
 */
export function exportFilename(groupTitle: string, now: Date, extension = "csv"): string {
  const base =
    // Cut by code point, not UTF-16 unit: slicing through an emoji's surrogate pair leaves a
    // lone surrogate, which makes `encodeURIComponent` in `contentDisposition` throw.
    Array.from(groupTitle.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim())
      .slice(0, 60)
      .join("") || "group";
  return `${base}-${now.toISOString().slice(0, 10)}.${extension}`;
}

/**
 * Content-Disposition value. The group name is usually Chinese, which a plain
 * `filename=` can't carry, so send an ASCII fallback plus the RFC 5987 form.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
