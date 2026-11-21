import { describe, expect, it } from "vitest";
import * as echarts from "echarts";

import {
  monthAxisLabels,
  monthTooltipLabel,
  netSignPieces,
  netTrendMinInterval,
} from "../stats-chart";

/** Render a net-trend line the way the stats page does and return the SVG. */
function render(values: number[]): string {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 360, height: 200 });
  try {
    chart.setOption({
      animation: false,
      xAxis: { type: "time" },
      yAxis: { type: "value" },
      visualMap: { show: false, dimension: 1, pieces: netSignPieces(values) },
      series: [
        {
          type: "line",
          data: values.map((v, i) => [Date.UTC(2026, 5, 1 + i * 20), v]),
          areaStyle: { opacity: 0.16 },
        },
      ],
    });
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

describe("netSignPieces", () => {
  it.each([
    ["all positive", [0, 8000, 31000, 25942.31]],
    ["all negative", [-100, -2500, -800]],
    ["crossing zero", [-5000, 8000, -300, 1200]],
    ["all zero", [0, 0]],
    ["one point", [42]],
  ])("lets ECharts draw the line when %s", (_label, values) => {
    // Open pieces ({ min: 0 } / { max: 0 }) made ECharts throw here and draw nothing.
    const svg = render(values);
    expect(svg).toMatch(/<path[^>]*stroke="url\(#/);
  });

  it("colours zero and above emerald, below zero rose", () => {
    const [positive, negative] = netSignPieces([-10, 10]);
    expect(positive).toMatchObject({ gte: 0, color: "#10b981" });
    expect(positive.lte).toBeGreaterThan(10);
    expect(negative).toMatchObject({ lt: 0, color: "#f43f5e" });
    expect(negative.gte).toBeLessThan(-10);
  });
});

describe("monthAxisLabels", () => {
  it("names months within one year without the year", () => {
    expect(monthAxisLabels(["2026-06", "2026-07", "2026-11"])).toEqual(["6月", "7月", "11月"]);
  });

  it("never reads like a day of the month", () => {
    // `06/26` (June 2026) looked like June 26th.
    for (const label of monthAxisLabels(["2026-06", "2026-07"])) expect(label).not.toMatch(/\//);
  });

  it("puts the year on the first bar and each January when the bars cross a year", () => {
    expect(monthAxisLabels(["2025-11", "2025-12", "2026-01", "2026-02"])).toEqual([
      "2025/11",
      "12月",
      "2026/1",
      "2月",
    ]);
  });
});

describe("monthTooltipLabel", () => {
  it("spells out the year and month", () => {
    expect(monthTooltipLabel("2026-06")).toBe("2026年6月");
  });
});

describe("netTrendMinInterval", () => {
  const day = 86_400_000;
  it("ticks monthly past two months and weekly below", () => {
    expect(netTrendMinInterval(0, 92 * day)).toBe(28 * day);
    expect(netTrendMinInterval(0, 31 * day)).toBe(7 * day);
  });
});
