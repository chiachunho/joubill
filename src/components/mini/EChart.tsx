"use client";

import { useEffect, useRef } from "react";
import type { EChartsOption } from "echarts";
import type * as echartsCoreNs from "echarts/core";

type EchartsCore = typeof echartsCoreNs;
type ECharts = ReturnType<EchartsCore["init"]>;

let registered: EchartsCore | null = null;

/**
 * Load echarts modules lazily (saves the ~700kb main bundle on SSR / initial
 * paint). use() is idempotent, so re-imports on subsequent mounts are free.
 */
async function loadEcharts(): Promise<EchartsCore> {
  if (registered) return registered;
  const [core, charts, components, renderers] = await Promise.all([
    import("echarts/core"),
    import("echarts/charts"),
    import("echarts/components"),
    import("echarts/renderers"),
  ]);
  core.use([
    charts.BarChart,
    components.GridComponent,
    components.TooltipComponent,
    renderers.CanvasRenderer,
  ]);
  registered = core;
  return core;
}

export function EChart({
  option,
  height = 240,
  className,
}: {
  option: EChartsOption;
  height?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ECharts | null>(null);
  const latestOptionRef = useRef(option);
  latestOptionRef.current = option;

  // Initialise once; dispose on unmount. Reading the option from a ref avoids
  // stale closures and keeps the option-change effect below as the single
  // source of truth for updates.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    let cleanupResize: (() => void) | undefined;

    loadEcharts().then((echarts) => {
      if (cancelled || !el) return;
      const inst = echarts.init(el);
      instanceRef.current = inst;
      inst.setOption(latestOptionRef.current);

      const onResize = () => inst.resize();
      window.addEventListener("resize", onResize);
      cleanupResize = () => window.removeEventListener("resize", onResize);
    });

    return () => {
      cancelled = true;
      cleanupResize?.();
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, []);

  // Update option in place — no dispose/reinit per change.
  useEffect(() => {
    instanceRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={containerRef} className={className} style={{ width: "100%", height }} />;
}
