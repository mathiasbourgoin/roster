import type { EChartsCoreOption } from "echarts";
import type { MetricResult, ScopeResult } from "@/lib/analysis/compute";

const GOOD = "#2ea043";
const BAD = "#e5484d";
const NEUTRAL = "#8b95a1";
const GRID = "#2a3240";
const TEXT = "#9aa7b4";

export type Direction = "up-good" | "down-good" | "neutral";

// Color a % change by whether it's good or bad for this metric.
export function deltaColor(direction: Direction, pct: number | null): string {
  if (pct === null || direction === "neutral") return NEUTRAL;
  const positive = pct >= 0;
  if (direction === "up-good") return positive ? GOOD : BAD;
  return positive ? BAD : GOOD; // down-good
}

export function formatDelta(pct: number | null): string {
  if (pct === null) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function formatValue(v: number | null, unit: string): string {
  if (v === null) return "—";
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (unit === "ratio") return v.toFixed(2);
  if (v >= 1000) return Math.round(v).toLocaleString();
  return v.toFixed(v < 10 ? 2 : 1);
}

const baseGrid = { left: 44, right: 16, top: 18, bottom: 28 };

// Time-series line for one metric in one scope (the "how it evolved" view).
export function timeSeriesOption(
  result: MetricResult,
  color: string,
  unit: string,
): EChartsCoreOption {
  const months = result.timeseries.map((p) => p.month);
  const values = result.timeseries.map((p) => p.value);
  return {
    grid: baseGrid,
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1c2330",
      borderColor: GRID,
      textStyle: { color: "#e6edf3" },
      valueFormatter: (v: unknown) => formatValue(v as number | null, unit),
    },
    xAxis: {
      type: "category",
      data: months,
      axisLabel: { color: TEXT, fontSize: 10, formatter: (m: string) => m.slice(2) },
      axisLine: { lineStyle: { color: GRID } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: TEXT, fontSize: 10 },
      splitLine: { lineStyle: { color: GRID, opacity: 0.4 } },
    },
    series: [
      {
        type: "line",
        data: values,
        smooth: true,
        connectNulls: true,
        showSymbol: false,
        lineStyle: { color, width: 2 },
        areaStyle: { color, opacity: 0.12 },
      },
    ],
  };
}

// Overlay every selected scope (repos + aggregate) for one metric.
export function multiScopeTimeSeries(
  metricId: string,
  scopes: ScopeResult[],
  unit: string,
): EChartsCoreOption {
  const palette = ["#d12b2b", "#3b82f6", "#2ea043", "#d29922", "#a855f7", "#06b6d4", "#ec4899"];
  const months = scopes[0]?.metrics[metricId]?.timeseries.map((p) => p.month) ?? [];
  return {
    grid: { ...baseGrid, bottom: 48 },
    tooltip: { trigger: "axis", backgroundColor: "#1c2330", borderColor: GRID, textStyle: { color: "#e6edf3" } },
    legend: { bottom: 0, textStyle: { color: TEXT, fontSize: 10 }, type: "scroll" },
    xAxis: {
      type: "category",
      data: months,
      axisLabel: { color: TEXT, fontSize: 10, formatter: (m: string) => m.slice(2) },
      axisLine: { lineStyle: { color: GRID } },
    },
    yAxis: { type: "value", axisLabel: { color: TEXT, fontSize: 10 }, splitLine: { lineStyle: { color: GRID, opacity: 0.4 } } },
    series: scopes.map((sc, i) => ({
      name: sc.label,
      type: "line",
      smooth: true,
      connectNulls: true,
      showSymbol: false,
      data: sc.metrics[metricId]?.timeseries.map((p) => p.value) ?? [],
      lineStyle: { color: palette[i % palette.length], width: 2 },
    })),
  };
}

// Report-style "% change low → high AI adoption" bar chart for a finding.
export function whiplashBarOption(
  metrics: { id: string; label: string; direction: Direction }[],
  scope: ScopeResult,
): EChartsCoreOption {
  const points = metrics
    .map((m) => ({ label: m.label, pct: scope.metrics[m.id]?.pctChange ?? null, dir: m.direction }))
    .filter((p) => p.pct !== null);
  return {
    grid: { left: 44, right: 24, top: 28, bottom: 70 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "#1c2330",
      borderColor: GRID,
      textStyle: { color: "#e6edf3" },
      valueFormatter: (v: unknown) => formatDelta(v as number),
    },
    xAxis: {
      type: "category",
      data: points.map((p) => p.label),
      axisLabel: { color: TEXT, fontSize: 10, interval: 0, width: 90, overflow: "break" },
      axisLine: { lineStyle: { color: GRID } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: TEXT, fontSize: 10, formatter: "{value}%" },
      splitLine: { lineStyle: { color: GRID, opacity: 0.4 } },
    },
    series: [
      {
        type: "bar",
        data: points.map((p) => ({
          value: p.pct,
          itemStyle: { color: deltaColor(p.dir, p.pct), borderRadius: [3, 3, 0, 0] },
          label: {
            show: true,
            position: (p.pct ?? 0) >= 0 ? "top" : "bottom",
            color: deltaColor(p.dir, p.pct),
            fontWeight: 700,
            fontSize: 11,
            formatter: () => formatDelta(p.pct),
          },
        })),
        barMaxWidth: 48,
      },
    ],
  };
}
