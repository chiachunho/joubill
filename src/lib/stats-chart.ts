/**
 * Chart options for the stats page that are easy to get wrong without an error. Pure, so
 * the test can render them through ECharts itself.
 */

const NET_POSITIVE_COLOR = "#10b981";
const NET_NEGATIVE_COLOR = "#f43f5e";

/**
 * The visualMap pieces that colour the net-trend line by sign: emerald at or above zero,
 * rose below.
 *
 * Each piece is bounded by the data instead of left open (`{ min: 0 }` / `{ max: 0 }`).
 * ECharts turns a piecewise visualMap into gradient stops only from bounded pieces, and its
 * line view reads the first stop without checking there is one, so two open pieces throw
 * inside the render and the series silently draws nothing: an empty chart under the right
 * headline number. The margin keeps both pieces non-empty when every value is 0.
 */
export function netSignPieces(values: number[]) {
  const top = Math.max(0, ...values) + 1;
  const bottom = Math.min(0, ...values) - 1;
  return [
    { gte: 0, lte: top, color: NET_POSITIVE_COLOR },
    { gte: bottom, lt: 0, color: NET_NEGATIVE_COLOR },
  ];
}

const DAY_MS = 86_400_000;

/**
 * The smallest gap between ticks on the net trend's time axis. Left to itself ECharts puts
 * a tick every week on a three-month range, and on a phone those day labels run into each
 * other. Past two months the ticks are monthly; shorter ranges keep weekly ones.
 */
export function netTrendMinInterval(firstMs: number, lastMs: number): number {
  return lastMs - firstMs > 62 * DAY_MS ? 28 * DAY_MS : 7 * DAY_MS;
}

/**
 * Bar labels for the monthly chart, from `YYYY-MM` keys. They used to read `06/26` (month and
 * two-digit year), which looks like June 26th. Now a month is `6月`; when the bars cross a
 * year, the first bar and each January carry the year instead (`2026/1`).
 */
export function monthAxisLabels(monthKeys: string[]): string[] {
  const crossesYear = new Set(monthKeys.map((k) => k.slice(0, 4))).size > 1;
  return monthKeys.map((key, i) => {
    const year = key.slice(0, 4);
    const month = Number(key.slice(5, 7));
    return crossesYear && (i === 0 || month === 1) ? `${year}/${month}` : `${month}月`;
  });
}

/** A monthly bar's tooltip title: `2026年6月`. */
export function monthTooltipLabel(monthKey: string): string {
  return `${monthKey.slice(0, 4)}年${Number(monthKey.slice(5, 7))}月`;
}
