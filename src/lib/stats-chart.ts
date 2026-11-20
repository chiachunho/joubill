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
