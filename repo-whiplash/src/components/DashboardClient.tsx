"use client";

import { useCallback, useEffect, useState } from "react";
import RepoPanel, { type RepoItem } from "@/components/RepoPanel";
import AnalysisView from "@/components/AnalysisView";
import type { AnalysisResult } from "@/lib/analysis/compute";

export default function DashboardClient() {
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [cutoff, setCutoff] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const res = await fetch("/api/repos");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed to load repos");
      setRepos((data.repos as RepoItem[]).filter((r) => r.fullName));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  const loadAnalysis = useCallback(async (cutoffDate?: string) => {
    const qs = cutoffDate ? `?cutoff=${cutoffDate}` : "";
    const res = await fetch(`/api/analysis${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "failed to analyze");
    setAnalysis(data as AnalysisResult);
    if (!cutoffDate && data.cutoff) setCutoff((data.cutoff as string).slice(0, 10));
  }, []);

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  const persistSelection = useCallback(async (next: RepoItem[]) => {
    const selected = next.filter((r) => r.selected);
    await fetch("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repos: selected.map((r) => ({
          provider: r.provider,
          fullName: r.fullName,
          externalId: r.externalId,
          private: r.private,
        })),
      }),
    });
  }, []);

  const onToggle = useCallback(
    (repo: RepoItem, selected: boolean) => {
      setRepos((prev) => {
        const next = prev.map((r) =>
          r.provider === repo.provider && r.fullName === repo.fullName ? { ...r, selected } : r,
        );
        void persistSelection(next);
        return next;
      });
    },
    [persistSelection],
  );

  const onSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setStatus("Fetching repository data…");
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "sync failed");
      const synced = (data.results ?? []).reduce(
        (acc: number, r: { prs: number }) => acc + r.prs,
        0,
      );
      setStatus(`Synced ${data.results?.length ?? 0} repos (${synced} PRs). Analyzing…`);
      if (data.errors?.length) {
        setError(`Some repos failed: ${data.errors.map((e: { repo: string }) => e.repo).join(", ")}`);
      }
      await loadAnalysis();
      await loadRepos();
      setStatus(null);
    } catch (e) {
      setError(String(e));
      setStatus(null);
    } finally {
      setSyncing(false);
    }
  }, [loadAnalysis, loadRepos]);

  const onCutoffChange = useCallback(
    async (date: string) => {
      setCutoff(date);
      try {
        await loadAnalysis(date);
      } catch (e) {
        setError(String(e));
      }
    },
    [loadAnalysis],
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 340px) 1fr", gap: 20, alignItems: "start" }}>
      <div style={{ position: "sticky", top: 16 }}>
        <RepoPanel
          repos={repos}
          loading={loadingRepos}
          syncing={syncing}
          onToggle={onToggle}
          onSync={onSync}
        />
        {analysis && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>AI-adoption cutoff</h3>
            <p className="faint" style={{ marginTop: 0 }}>
              Everything before this date is the “low AI adoption” baseline; everything after is “high”.
              Auto-detected from AI-commit ramp; override to match your rollout.
            </p>
            <input type="date" value={cutoff} onChange={(e) => onCutoffChange(e.target.value)} style={{ width: "100%" }} />
          </div>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        {error && (
          <div className="card" style={{ borderColor: "var(--bad)", marginBottom: 16 }}>
            <strong style={{ color: "var(--bad)" }}>Error:</strong> <span className="muted">{error}</span>
          </div>
        )}
        {status && (
          <div className="card row" style={{ marginBottom: 16 }}>
            <span className="spinner" /> <span className="muted">{status}</span>
          </div>
        )}
        {!analysis && !status ? (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>No analysis yet</h2>
            <p className="muted">
              Select one or more repositories on the left, then press <strong>Sync &amp; analyze</strong>.
              You’ll get adoption levels, throughput, complexity, review load, flow, and production-quality
              metrics — per repo, aggregated, and over time.
            </p>
          </div>
        ) : analysis ? (
          <AnalysisView analysis={analysis} />
        ) : null}
      </div>
    </div>
  );
}
