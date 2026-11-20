import { describe, expect, it } from "vitest";
import * as echarts from "echarts";

import { netSignPieces } from "../stats-chart";

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
