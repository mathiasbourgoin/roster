"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

// Thin React wrapper around Apache ECharts. Avoids extra wrapper deps so it
// stays compatible with React 19.
export default function EChart({
  option,
  height = 280,
  className,
}: {
  option: echarts.EChartsCoreOption;
  height?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} className={className} style={{ width: "100%", height }} />;
}
