# ccusage adoption — cost/token telemetry (2026-07-22)

## What this is

Roster has no token/cost accounting today. This integration wires
[`ccusage`](https://github.com/ryoppippi/ccusage) — a local, offline reader of the JSONL
transcripts Claude Code, Codex, and OpenCode already write — into three advisory touchpoints:

1. `roster-doctor`'s `full`-mode report — an optional cross-runtime cost section (silent skip if
   `ccusage` is not resolvable; never auto-installed).
2. `roster-ship` — a per-task, aggregates-only cost snapshot appended to `skills-meta/cost.jsonl`
   at ship time, via a time-window join against the task's own state-ledger timestamps.
3. `roster-skill-health` — an optional cost↔friction correlation note, context only.

Every output is **advisory**: no phase gate, no verdict, and no AI-computed evaluation number ever
reads a cost figure (FR-166). Attribution is always `"approximate"` — no session ids exist to
disambiguate concurrent sessions in the same time window (FR-163).

Full requirements: `briefs/ccusage-metrics-spec.md` (FR-159…FR-170). Design rationale and open
questions: `briefs/ccusage-metrics-intake.md`, `roster/ccusage-metrics/research.md`.

## Duplication ruling (recorded verbatim, per FR-169)

> **ccusage = cross-runtime baseline (ADOPTED); Claude Code OTel = optional, richer,
> Claude-Code-only enhancement (DEFERRED, noted here — not built), not a parallel system.**

Rationale: roster targets Claude Code, Codex, and OpenCode uniformly. Claude Code's native
OpenTelemetry (`claude_code.cost.usage` / `claude_code.token.usage`, attributed by `skill.name`)
gives richer per-skill attribution but is Claude-Code-specific — Codex and OpenCode emit nothing
comparable. Adopting both as parallel systems would duplicate the same capability twice on the one
runtime they overlap. ccusage is the cross-runtime baseline now; a Claude-Code-only OTel exporter
remains explicitly out of scope for this task and is not built. Adjacent transcript-reading tools
(Claudescope, agenttrace, Token Tracker) were surveyed and are not adopted — same niche as ccusage.

## Relationship to future durable-telemetry work

This task does **not** build a `metrics/runs/<task>.json` join hub, a `Roster-Task:` commit
trailer, or a mandatory ledger `at` timestamp — those are a separate, deeper durable-record
("Layer 0") effort should a future task pursue it. This integration deliberately stops at an
approximate, time-window join against the *existing* (optional) ledger timestamps, and degrades to
`join_method: "time-window-ledger-partial"` / `window.since: null` when a bound is missing, rather
than guessing (see `briefs/ccusage-metrics-spec.md` FR-161…FR-163 for the exact contract).

> **Deviation note (implementer, 2026-07-22):** the plan brief (`briefs/ccusage-metrics-plan.md`
> sub-brief (e)) directed this cross-reference into
> `docs/plans/roster-effectiveness-monitoring-2026-06-25.md` §3/§7 and an existing project roadmap
> doc. Neither file exists anywhere in this repository's git history (checked `git log --all`) —
> the plan/intake/research briefs describe an effectiveness-monitoring plan doc that was never
> committed to this branch or any other. Rather than fabricate that (larger, out-of-scope) planning
> document from scratch, this standalone doc records the same ruling and caveats the spec requires
> (FR-169, FR-163, FR-166). Flagged for a human decision: either the missing plan doc should be
> written separately, or this note supersedes that sub-brief's target.
