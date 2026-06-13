"use client";

import { useMemo, useState } from "react";
import EChart from "@/components/charts/EChart";
import type { AnalysisResult, MetricResult, ScopeResult } from "@/lib/analysis/compute";
import {
  deltaColor,
  formatDelta,
  formatValue,
  multiScopeTimeSeries,
  timeSeriesOption,
  whiplashBarOption,
  type Direction,
} from "@/components/chartOptions";

type MetricDef = AnalysisResult["metricDefs"][number];

function latestValue(r: MetricResult | undefined): number | null {
  if (!r) return null;
  for (let i = r.timeseries.length - 1; i >= 0; i--) {
    if (r.timeseries[i].value !== null) return r.timeseries[i].value;
  }
  return null;
}

function ProvenanceBadge({ p }: { p: string }) {
  const cls = p === "direct" ? "badge-direct" : p === "proxy" ? "badge-proxy" : "badge-unavailable";
  return <span className={`badge ${cls}`}>{p}</span>;
}

export default function AnalysisView({ analysis }: { analysis: AnalysisResult }) {
  const [scopeKey, setScopeKey] = useState(analysis.scopes[0]?.key ?? "");
  const [overlay, setOverlay] = useState(false);

  const scope: ScopeResult | undefined =
    analysis.scopes.find((s) => s.key === scopeKey) ?? analysis.scopes[0];

  const byFinding = useMemo(() => {
    const map = new Map<number, MetricDef[]>();
    for (const d of analysis.metricDefs) {
      const arr = map.get(d.findingNum) ?? [];
      arr.push(d);
      map.set(d.findingNum, arr);
    }
    return map;
  }, [analysis.metricDefs]);

  if (!scope) return null;
  const adoption = byFinding.get(1) ?? [];
  const cutoffDate = analysis.cutoff.slice(0, 10);

  return (
    <div>
      {/* Controls */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row spread">
          <div className="row">
            <label className="faint">Scope</label>
            <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)}>
              {analysis.scopes.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            {analysis.scopes.length > 2 && (
              <label className="row faint" style={{ gap: 6 }}>
                <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
                Overlay all repos on time series
              </label>
            )}
          </div>
          <div className="faint">
            Low→High split at <strong>{cutoffDate}</strong> · window {analysis.range.from.slice(0, 7)} →{" "}
            {analysis.range.to.slice(0, 7)}
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="faint">
            <span className="legend-dot" style={{ background: "#2ea043" }} /> improving
          </span>
          <span className="faint">
            <span className="legend-dot" style={{ background: "#e5484d" }} /> worsening
          </span>
          <span className="faint">
            <span className="legend-dot" style={{ background: "#8b95a1" }} /> neutral
          </span>
          <span style={{ flex: 1 }} />
          <ProvenanceBadge p="direct" /> <ProvenanceBadge p="proxy" /> <ProvenanceBadge p="unavailable" />
        </div>
      </div>

      {/* Finding 1 — Adoption cards */}
      <div className="section-title">
        <span className="num">1</span>
        <h2>{analysis.findingTitles[1]}</h2>
      </div>
      <div className="grid grid-adopt">
        {adoption.map((def) => {
          const val = latestValue(scope.metrics[def.id]);
          return (
            <div className="card adopt-card" key={def.id}>
              <div className="big">{formatValue(val, def.unit)}</div>
              <div className="sub">{def.label}</div>
              <div style={{ marginTop: 8 }}>
                <ProvenanceBadge p={def.provenance} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Findings 2–7 */}
      {[2, 3, 4, 5, 6, 7].map((fn) => {
        const defs = byFinding.get(fn) ?? [];
        if (defs.length === 0) return null;
        const barMetrics = defs.map((d) => ({ id: d.id, label: d.label, direction: d.direction as Direction }));
        return (
          <section key={fn}>
            <div className="section-title">
              <span className="num">{fn}</span>
              <h2>{analysis.findingTitles[fn]}</h2>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <h3 className="muted">% change from low → high AI adoption</h3>
              <EChart option={whiplashBarOption(barMetrics, scope)} height={300} />
            </div>

            <div className="grid grid-cards">
              {defs.map((def) => {
                const res = scope.metrics[def.id];
                const pct = res?.pctChange ?? null;
                const option = overlay
                  ? multiScopeTimeSeries(def.id, analysis.scopes.filter((s) => s.key !== "aggregate"), def.unit)
                  : timeSeriesOption(res ?? { timeseries: [], low: null, high: null, pctChange: null }, deltaColor(def.direction as Direction, pct), def.unit);
                return (
                  <div className="card metric-card" key={def.id}>
                    <div className="row spread">
                      <span className="label">{def.label}</span>
                      <ProvenanceBadge p={def.provenance} />
                    </div>
                    <div className="delta" style={{ color: deltaColor(def.direction as Direction, pct) }}>
                      {formatDelta(pct)}
                    </div>
                    <div className="lowhigh">
                      {formatValue(res?.low ?? null, def.unit)} → {formatValue(res?.high ?? null, def.unit)} {def.unit !== "%" && def.unit}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <EChart option={option} height={150} />
                    </div>
                    <p className="faint" style={{ marginTop: 6 }}>{def.description}</p>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Gaps */}
      <div className="section-title">
        <h2 className="muted">Report metrics not derivable from VCS data</h2>
      </div>
      <div className="card">
        <p className="faint" style={{ marginTop: 0 }}>
          These appear in the report but require work-management or incident systems. They are listed
          here rather than estimated, so nothing is faked.
        </p>
        <ul className="muted">
          {analysis.unavailable.map((u, i) => (
            <li key={i}>
              <strong>{u.label}</strong> <span className="faint">— {u.finding} · needs {u.needs}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
