"use client";

import { useMemo, useState } from "react";

export interface RepoItem {
  provider: "github" | "gitlab";
  externalId: string;
  fullName: string;
  private: boolean;
  pushedAt: string | null;
  selected: boolean;
  lastSyncedAt: string | null;
  error?: string;
}

export default function RepoPanel({
  repos,
  loading,
  syncing,
  onToggle,
  onSync,
}: {
  repos: RepoItem[];
  loading: boolean;
  syncing: boolean;
  onToggle: (repo: RepoItem, selected: boolean) => void;
  onSync: () => void;
}) {
  const [filter, setFilter] = useState("");
  const selectedCount = repos.filter((r) => r.selected).length;

  const shown = useMemo(() => {
    const f = filter.toLowerCase();
    return repos.filter((r) => r.fullName && r.fullName.toLowerCase().includes(f));
  }, [repos, filter]);

  return (
    <div className="card">
      <div className="row spread" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Repositories</h2>
        <span className="tag">{selectedCount} selected</span>
      </div>

      <input
        type="text"
        placeholder="Filter repositories…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ width: "100%", marginBottom: 10 }}
      />

      {loading ? (
        <div className="row faint">
          <span className="spinner" /> Loading your repositories…
        </div>
      ) : repos.length === 0 ? (
        <p className="faint">No repositories found for the connected account(s).</p>
      ) : (
        <div className="repo-list">
          {shown.map((r) => (
            <label key={`${r.provider}:${r.fullName}`} className={`repo-item ${r.selected ? "sel" : ""}`}>
              <input
                type="checkbox"
                checked={r.selected}
                onChange={(e) => onToggle(r, e.target.checked)}
              />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.fullName}
              </span>
              <span className="tag">{r.provider}</span>
              {r.private && <span className="tag">private</span>}
              {r.lastSyncedAt && <span className="tag" title="last synced">✓</span>}
            </label>
          ))}
        </div>
      )}

      <hr className="hr" />
      <button className="btn btn-primary" onClick={onSync} disabled={syncing || selectedCount === 0} style={{ width: "100%" }}>
        {syncing ? (
          <>
            <span className="spinner" /> Syncing & analyzing…
          </>
        ) : (
          <>Sync {selectedCount} repo{selectedCount === 1 ? "" : "s"} & analyze</>
        )}
      </button>
      <p className="faint" style={{ marginTop: 8 }}>
        Fetches ~2 years of PRs, commits, issues and deployments. First sync of a large repo can take a
        minute; results are cached locally.
      </p>
    </div>
  );
}
