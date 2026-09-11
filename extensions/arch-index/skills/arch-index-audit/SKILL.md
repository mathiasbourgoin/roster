---
name: arch-index-audit
description: Deterministic audit-section provider — emits a markdown fragment (fan-in hotspots, underdocumented public symbols, exit/panic reachability) from the arch-index SQLite index.
version: 1.0.0
capability: code-intel
provides: audit-section
entry: bash audit.sh
requires_tools: [arch-index]
---

# arch-index-audit

Audit-section provider for roster-audit and code-quality-auditor. `audit.sh`
emits a markdown fragment on stdout, read-only against the SQLite index at
`.arch-index/index.db` (built by `arch-index-init` — never regenerated here).

The fragment's first content line is the mandatory index-freshness header:

```
<!-- index-freshness: <index.db mtime, ISO-8601 UTC> vs HEAD <commit short> -->
```

so consumers (and humans) can see when the index is stale relative to HEAD.

## Steps

1. The consumer (`scripts/code-intel-resolve.js audit`) invokes `bash audit.sh`
   from the project root with no arguments.
2. Degradation checks: index DB absent → exit 3 "index-missing"; neither
   `arch-index` nor `sqlite3` on PATH → exit 3. The consumer replaces the
   section with a one-line degraded notice and the audit continues.
3. The freshness header prints first, then up to three subsections — each only
   when its query returns data:
   - **Fan-in hotspots** — top symbols by caller count (change-risk concentration).
   - **Exposed and underdocumented** — public symbols with a low
     `comment_quality_score`.
   - **Exit/panic reachability** — call edges reaching `exit`/`panic`/`abort`.
4. Severity of anything reported here stays model-judged by the hosting audit;
   this fragment is deterministic evidence, not a verdict.
