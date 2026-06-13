# Repo Whiplash

Connect your **GitHub** and **GitLab** repositories (including private ones via OAuth) and measure
the *Acceleration Whiplash* from the 2026 AI Engineering Report against your **own** code —
**per repo, aggregated, and over time**.

It reproduces the report's metric families (adoption, cognitive load, throughput, code complexity,
pre-merge quality, flow & efficiency, production quality) from real VCS data, with **dynamic
charts**: monthly time-series so you can see how each metric evolves, plus the report's signature
"% change from low → high AI adoption" bars.

> **Honesty about data:** version-control APIs don't say "this code was AI-generated", and several
> report metrics live in Jira / incident systems. Every metric is tagged **direct**, **proxy**, or
> **unavailable**, and nothing is faked. See [`docs/PLAN.md`](docs/PLAN.md) for the full mapping.

## Stack

Next.js (App Router) · TypeScript · Auth.js (NextAuth v5) · Prisma + SQLite · Apache ECharts.

## Quick start

```bash
npm install
cp .env.example .env       # then fill in the values (see below)
npm run db:push            # create the local SQLite schema
npm run dev                # http://localhost:3000
```

### Configure OAuth

**GitHub** — create an OAuth App at <https://github.com/settings/developers>:
- Authorization callback URL: `http://localhost:3000/api/auth/callback/github`
- The app requests the `repo` scope so private repositories are visible.
- Put the client id/secret in `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`.

**GitLab** — create an Application at <https://gitlab.com/-/profile/applications>:
- Redirect URI: `http://localhost:3000/api/auth/callback/gitlab`
- Scopes: `read_user read_api read_repository`
- Put the application id/secret in `AUTH_GITLAB_ID` / `AUTH_GITLAB_SECRET`.
- Self-managed GitLab? Set `GITLAB_BASE_URL` to your instance.

Generate `AUTH_SECRET` with `npx auth secret` (or `openssl rand -base64 33`).

## How it works

1. **Sign in** with GitHub and/or GitLab.
2. **Select repositories** from the live list (private repos included).
3. **Sync** — the server fetches ~2 years of PRs, commits, issues, and deployments using your
   OAuth token (held server-side only) and caches them in SQLite to respect rate limits.
4. **Analyze** — a pure TypeScript engine buckets entities by month, splits them at the
   AI-adoption cutoff, and computes every metric per repo and aggregated.
5. **Explore** — switch scope (aggregate / each repo), overlay repos on the time series, and move
   the AI-adoption cutoff to match your rollout.

### AI-adoption signal

Two signals drive the "low → high AI adoption" comparison:
- **Trailer detection** — commits/PRs carrying co-author or generation trailers from known tools
  (Claude, Copilot, Cursor, Windsurf, Devin, Aider, …). See `src/lib/ai-detection.ts`.
- **Manual cutoff** — a date you set (auto-detected from the AI-commit ramp by default).

## Project layout

```
src/
  auth.ts                     Auth.js (GitHub + GitLab) config
  lib/
    db.ts                     Prisma client
    ai-detection.ts           AI trailer heuristics
    sync.ts                   fetch + cache orchestration
    providers/                GitHub & GitLab clients → normalized model
    analysis/                 metric registry + time-series/low→high engine
  app/
    api/{repos,sync,analysis} server routes (tokens never leave the server)
    dashboard/                authed dashboard
  components/                 RepoPanel, AnalysisView, ECharts wrapper, chart builders
```

## Limitations

- Per-commit file/stat detail on GitHub costs one API call per commit; large repos are capped
  (`COMMIT_DETAIL_CAP` in `src/lib/providers/github.ts`) — raise it if you need full coverage.
- Issue **reopen** events and Jira-style workflow times aren't fetched; those metrics are listed as
  `unavailable` rather than approximated.
- "Bugs"/"incidents" are proxied from issue **labels** (`bug`, `incident`, `sev*`, …).
