# Repo Whiplash — Plan

A web app that connects to GitHub + GitLab (OAuth, including private repos), analyzes
selected repositories, and reproduces the metrics from the Faros *AI Engineering Report 2026 —
"The Acceleration Whiplash"* from **real repository data** — per repo, aggregated, and **over time**.

## What the report measures (and what we can compute)

The report compares engineering metrics between **low** and **high** AI-adoption periods,
grouped into 7 findings. Not all of it is derivable from version-control APIs. We are explicit
about provenance for every metric:

- `direct`   — computed straight from GitHub/GitLab data.
- `proxy`    — approximated from VCS data (e.g. "bugs" = issues labeled bug/incident).
- `unavailable` — needs Jira / incident-management integration; shown as a placeholder, never faked.

### Finding catalog

| # | Finding | Metric | Provenance |
|---|---------|--------|-----------|
| 1 | Adoption | % devs with AI-trailer commits, % PRs AI-assisted, AI acceptance proxy | proxy |
| 2 | Cognitive load | daily PR contexts/dev, daily task contexts/dev, work restarts, stalled in-progress | direct / proxy |
| 3 | Throughput | task throughput, epics, PR merge rate, tasks w/ PR, deployments/wk, code churn | direct / proxy |
| 4 | Complexity | PR size, files edited/PR, files touched/dev/mo, repos touched/dev/mo | direct |
| 5 | Pre-merge quality | review comments/PR, comment length, PRs merged without review | direct |
| 6 | Flow & efficiency | time-to-first-review, time-in-review (avg/median), in-progress, waiting, QA, lead time | direct / unavailable |
| 7 | Production quality | incidents/PR, monthly incidents, bugs/dev, bugs/PR, reopened tickets | proxy |

## AI-adoption dimension

VCS APIs do not say "this code was AI-generated." We use two signals:

1. **Trailer detection** — commits / PRs whose messages contain co-author or generation trailers
   for known tools (Claude, Copilot, Cursor, Windsurf, Devin, Aider, ...).
2. **Manual cutoff** — the user sets a pre-AI/post-AI date; the app computes the report's
   "% change from low → high AI adoption" between the two windows.

## Architecture

- **Next.js (App Router) + TypeScript** — server routes hold OAuth tokens; client renders charts.
- **Auth.js (NextAuth v5)** — GitHub + GitLab providers, scopes for private repos.
- **Prisma + SQLite** — cache raw fetched entities so re-analysis is fast and rate-limit friendly.
- **ECharts** (thin custom React wrapper) — time-series evolution, report-style low→high bars,
  adoption cards. Per-repo and aggregated.
- **Analysis engine** — pure TS: normalize → bucket by month → split by AI adoption → compute.

## Data flow

1. Sign in (GitHub/GitLab) → 2. pick repos → 3. sync (fetch + cache raw) →
4. analyze (bucket + AI-split + compute) → 5. dashboard (evolution + low→high, per-repo/aggregate).

## v1 scope

Everything above except `unavailable` metrics (Jira epics/in-progress/QA times, true incident
feeds), which render as labeled placeholders with guidance on which integration unlocks them.
