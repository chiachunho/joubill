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

/** Format an amount with the currency code suffixed: 1234.5 -> "1,234.50 TWD". */
export function formatMoney(amount: number, currency: string): string {
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const signed = amount > 0 ? `+${formatted}` : formatted;
  return `${signed} ${currency}`;
}

/** Convert a Drizzle numeric column (returned as string) to a JS number. */
export function n(value: string | number): number {
  return typeof value === "string" ? parseFloat(value) : value;
}
