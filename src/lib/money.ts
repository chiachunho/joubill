/**
 * Split an amount equally into n shares (cent-precise).
 * The first `remainder` shares get one extra cent so the sum matches exactly.
 *
 * splitEqual(10, 3) -> [3.34, 3.33, 3.33]
 */
export function splitEqual(amount: number, n: number): number[] {
  if (n <= 0) throw new Error("splitEqual: n must be positive");
  const cents = Math.round(amount * 100);
  const base = Math.floor(cents / n);
  const remainder = cents - base * n;
  return Array.from({ length: n }, (_, i) => (i < remainder ? base + 1 : base) / 100);
}

/** Format a number: integers show without decimals, others show 2 dp. */
export function fmt(amount: number): string {
  const s = amount.toFixed(2);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

/** Like fmt, but with thousands separators: 5200 -> "5,200", 1800.5 -> "1,800.50". */
export function fmtGrouped(amount: number): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Format a signed monetary amount: "+300 TWD" or "-33.50 TWD". */
export function formatMoney(amount: number, currency: string): string {
  const sign = amount >= 0 ? "+" : "-";
  return `${sign}${fmt(Math.abs(amount))} ${currency}`;
}

/** Convert a Drizzle numeric column (returned as string) to a JS number. */
export function n(value: string | number): number {
  return typeof value === "string" ? parseFloat(value) : value;
}
