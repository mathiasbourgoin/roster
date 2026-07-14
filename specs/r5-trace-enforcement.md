---
name: r5-trace-enforcement
type: spec
status: DRAFT
feature: R-5 graduation — gate-enforced reviewer invocation traces
brief: briefs/r5-trace-enforcement-intake.md
date: 2026-07-13
version: 1.1.0
---

# Spec — R-5 Trace Enforcement (reviewer invocation traces, gate-enforced)

> A-1 (re-validation 2026-07-14, post lib-split c0123a0): xruntime-journal.js is at scripts/lib/xruntime/ (NOT review/) — FR-164/FR-166 corrected. check-review-convergence.js now 474/500 lines (FR-178 extract-if->500 contingency more likely). roster-review base v2.2.2 (target 2.3.0 unchanged). selectCause + review-convergence-rules.js live in scripts/lib/review/. All FR logic, gate-integration, exit-contract (0/1/2/3), trust model, INV-1..8 assumptions verified intact.

Graduates residual **R-5** (`specs/review-skill-slimming.md`, line 43: "invocation traces are
auditable but not yet gate-enforced") into a mechanical gate check: every trace-obligated review
round must leave persistent, schema-valid evidence that the reviewer's required tooling (scope
gate, normalizer, specialists, cross-runtime helper) actually ran — a reviewer that skips its
tools and asserts a verdict no longer passes `scripts/check-review-convergence.js`.

**Trust model (binding, OQ2):** `rounds_audit`-level trust for v1 — schema-valid self-reported
trace lines cross-checked against `rounds_audit`, `normalized_by`, the xruntime journal, and the
gate report. No cryptographic attestation; no new deterministic wrapper per specialist (deferred
residual **R-5b**, see Residuals). One existing deterministic helper is extended
(`scripts/review-normalize.js` self-appends its own line, FR-166) because the helper already
exists — consistent with OQ2's "prefer the helper model where a helper already exists".

**Path convention:** new rule-module paths are written as `scripts/lib/review/…` throughout.
This **depends on the concurrent `scripts-lib-split` task landing first** (it moves review-family
lib files from `scripts/lib/` to `scripts/lib/review/`). If this task lands before the split, the
implementer places files in `scripts/lib/` and the split task carries them — the module names and
contracts here are authoritative either way.

## Clarifications

Resolved by binding gate decisions passed to this phase (challenged where defective — see C-1,
C-2; refinements are recorded there, never silently applied):

| Q | A |
|---|---|
| Exit semantics for trace failures (OQ1)? | Reuse existing 0/1/2/3 codes with new cause/violation types. Missing trace for a trace-obligated round → **exit 3** (`process-incomplete`, repairable pre-persist). Claimed-invocation-without-trace-line → **exit 1** (design violation, new cause `unattested-invocation`). Unreadable/malformed trace → **exit 2** (fail-closed). NO new exit code. Routing refinement per C-1. |
| Integrity level of the trace (OQ2)? | `rounds_audit`-level trust: schema-valid self-reported lines cross-checked against `rounds_audit`/`normalized_by`/xruntime journal/gate report. Wrapper-per-specialist deferred as **R-5b**. |
| Correspondence scope (OQ3)? | Exactly the brief's candidate minimum: `specialists_run` entries, §2.5 scope-gate run, §4 normalizer run, cross-runtime corroboration (against the existing journal — never duplicated). `findings[].check` red/green runs explicitly excluded — the gate executes those itself and records them in `checks[]`. |
| Legacy/rollout (OQ4)? | B-8 pattern for legacy. A round is trace-obligated iff the trace file exists for the task OR the round's `rounds_audit` entry carries `trace_schema_version` (echoed as `schema_version` in trace lines, required for new rounds by the skill contract). Soundness gap and mitigation in C-2. |
| Placement (OQ5)? | Rule logic in `scripts/lib/review/review-trace-rules.js`; `check-review-convergence.js` stays the single verdict authority and gains **thin dispatch only**. |
| Which file carries the trace? | A sibling `briefs/<task>-review-trace.jsonl` — never `briefs/<task>-xruntime.jsonl` (the journal is an INV-4 enforcement input for `shouldRefuseDegraded`; its read set must stay byte-for-byte what it is today). |
| Does the gate write trace lines? | Never. The gate's read-only guarantee (FR-022/A-2) is preserved unconditionally; producers (reviewer skill + normalizer) write, the gate only reads. |
| Are Express/Fast rounds scope-gate-obligated? | No. §2.5 skips unconditionally in Express/Fast by design; the scope-gate trace obligation applies only when `review.json.mode == "full"` (EC-6). |

## User Stories

### US-1: Machine-checkable trace artifact (Priority: P0)
As the review pipeline, I want a defined per-task JSONL trace artifact with a JSON Schema
validated by the existing zero-dep interpreter, so reviewer tool invocations leave evidence a
deterministic gate can check instead of trusting skill prose.
**Why this priority**: everything else in this spec consumes this artifact; without a pinned
shape the gate check is unimplementable.
**Scope**: This story does NOT cover who writes the lines (US-2) or how the gate judges them
(US-3).
**Independent Test**: compile `schema/review-trace.schema.json` with the zero-dep interpreter and
validate one conforming and one non-conforming line.
**Acceptance Scenarios**:
1. **Given** `schema/review-trace.schema.json` as shipped, **When** it is compiled by the
   interpreter in `scripts/lib/review/finding-schema.js` (which throws on any keyword outside
   `type, enum, required, properties, additionalProperties, items`), **Then** compilation
   succeeds without throwing.
2. **Given** the line `{"schema_version":"1.0","ts":"2026-07-13T10:00:00Z","task":"demo-task",
   "round":1,"cycle":1,"event":"normalizer","actor":"review-normalize.js","outcome":"ran"}`,
   **When** validated against the schema, **Then** it is valid.
3. **Given** the same line with `"event":"coffee-break"` (not in the enum) or with the `event`
   key deleted, **When** validated, **Then** validation fails with a field-path error — never a
   silent accept.

### US-2: Producer wiring — trace lines are actually written (Priority: P0)
As the roster-review skill (v2.2.2 → v2.3.0), I want §2.5, §3, and §4 to append trace lines
append-before-report, and the normalizer to append its own line deterministically, so a round's
evidence exists before the round's claims do.
**Why this priority**: gate-side verification of an artifact nothing produces would fail-closed
every new round — producer and verifier must ship together.
**Scope**: This story does NOT cover gate-side verification (US-3) or wrapping specialists in
deterministic helpers (R-5b, out of scope for v1).
**Independent Test**: run one Full-mode review round on a scratch task; inspect
`briefs/<task>-review-trace.jsonl` for the scope-gate, per-specialist, and normalizer lines with
correct `round`/`cycle`.
**Acceptance Scenarios**:
1. **Given** a Full-mode round 2 where §3 runs specialists `reviewer` and `architect`, **When**
   the round's `rounds_audit` entry is composed, **Then** the trace file already contains
   `{event:"specialist",actor:"reviewer",round:2,...}` and `{event:"specialist",
   actor:"architect",round:2,...}` — appended before the entry, not reconstructed after.
2. **Given** Full mode with `briefs/<task>-manifest.txt` present, **When** §2.5 runs
   `scripts/check-scope-diff.sh`, **Then** a `{event:"scope-gate",outcome:"ran"}` line is
   appended before its findings are merged; **Given** the manifest is absent, **Then** the line
   is `{event:"scope-gate",outcome:"skipped",detail:"no-manifest"}`.
3. **Given** `scripts/review-normalize.js` runs and its trace append fails (e.g. `EACCES` on
   `briefs/`), **When** it emits its stdout JSON, **Then** the output carries an explicit
   append-failure warning — never silently healthy (FR-096 pattern).

### US-3: Gate verification with exact exit routing (Priority: P0)
As the convergence gate, I want to verify that a trace exists for the current round and that
every claimed invocation corresponds to a recorded trace/journal line, routing failures onto the
existing 0/1/2/3 exit contract, so a skipped tool is mechanically indistinguishable from a lie
about a skipped tool — and both block.
**Why this priority**: this is R-5's graduation itself — the enforcement teeth.
**Scope**: This story does NOT cover `findings[].check` red/green runs (gate-executed, already
in `checks[]`), QA-phase traces, or any gate write.
**Independent Test**: run `node scripts/check-review-convergence.js` against four fixtures
(missing trace / unattested claim / malformed line / fully corroborated) and assert exits
3 / 1 / 2 / 0.
**Acceptance Scenarios**:
1. **Given** a trace-obligated round 2 (`rounds_audit[round==2].trace_schema_version == "1.0"`)
   with zero schema-valid trace lines for `(cycle, round=2)`, **When** the gate runs, **Then**
   exit 3 with a violation `{type:"missing-trace", cause:"process-incomplete"}` and the
   top-level `cause` is null (process-incomplete is never top-level).
2. **Given** round 2 trace lines exist but `specialists_run` claims `architect` with no matching
   `{event:"specialist",actor:"architect",round:2}` line, **When** the gate runs, **Then** exit 1
   with `{type:"unattested-invocation", cause:"unattested-invocation"}` naming the claim.
3. **Given** a line inside the current cycle's scope that is unparseable JSON or schema-invalid,
   **When** the gate runs, **Then** exit 2 (fail-closed degraded input) — while a corrupt line
   from a **prior** cycle yields only a warning (EC-2).
4. **Given** `cross_runtime.codex` claims `{status:"healthy", round:2, config_digest:"d1"}` but
   `briefs/<task>-xruntime.jsonl` has no entry matching `(runtime:"codex", digest:"d1",
   cycle:<current>)`, **When** the gate runs, **Then** exit 1 `unattested-invocation` — the
   journal is read read-only for corroboration; nothing is written or duplicated into the trace.

### US-4: Skip-vs-forgot is mechanically distinguishable (Priority: P1)
As the pipeline maintainer, I want legacy rounds to skip with a warning (B-8) while any
new-mechanism round is fail-closed on absent evidence, so the rollout never bricks in-flight
tasks and a new round can never silently opt out by "looking legacy".
**Why this priority**: P1 only because US-1..3 are prerequisites; this is nonetheless the heart
of the task — without it US-3 is evadable by omission.
**Scope**: This story does NOT cover retrofitting traces onto historical tasks or re-gating
already-persisted verdicts.
**Independent Test**: run the gate against (a) a legacy fixture, (b) a versioned-entry-no-file
fixture, (c) a file-exists-no-version-field fixture; assert warn-skip / exit 3 / obligated.
**Acceptance Scenarios**:
1. **Given** a legacy `review.json` with no `round` key, **When** the gate runs, **Then** trace
   checks are skipped entirely with a warning, and all 17 pre-existing legacy fixtures pass
   unmodified.
2. **Given** a mid-flight pre-mechanism task — no `briefs/<task>-review-trace.jsonl` and the
   current round's `rounds_audit` entry has no `trace_schema_version` — **When** the gate runs,
   **Then** trace checks are skipped with the warning
   `"round <r> predates the trace mechanism — trace checks skipped (B-8)"`.
3. **Given** the current round's `rounds_audit` entry carries `trace_schema_version:"1.0"` and
   no trace file exists, **When** the gate runs, **Then** exit 3 `missing-trace` — a
   trace-aware round that forgot is never mistaken for a legacy skip.
4. **Given** the trace file exists (e.g. the normalizer self-appended its line, FR-166) but the
   reviewer omitted `trace_schema_version` from the `rounds_audit` entry, **When** the gate
   runs, **Then** the round is still trace-obligated via the file-existence prong — omitting the
   field cannot un-obligate a task whose evidence file already exists.

## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | US-3 | **Defect found in the OQ1 gate decision as literally applied.** Exit 1 today makes roster-review set `no_go_reason.type = "design-not-converging"`, whose causes route to `/roster-spec` (or the streak override to `/roster-implement`). An unattested invocation is not a design-convergence failure — it is a review-process integrity failure; routing it to the spec phase is wrong and would also collide with the persisted-cause enum (`round-cap \| unencodable-finding \| novel-finding-streak`). | Exit code 1 is **kept** (the binding decision's code choice stands — it IS a design violation of the review contract). The refinement: new top-level cause `unattested-invocation` with its own routing in §5.5 — `no_go_reason.type = "review-integrity-failure"`, action = re-run the current round's claimed tooling for real (which appends the evidence) and re-review; **never** routed as design-not-converging, never eligible for the streak override. `schema/review-json-schema.md`'s two enums are extended accordingly (FR-174/FR-175). Flagged as an open point for human validation since it adds a `no_go_reason.type` value that roster-run's routing table must treat as non-spec-routing. |
| C-2 | US-4 | **Soundness gap in the OQ4 keying, named explicitly per the phase instruction.** The `trace_schema_version` prong is skill-contract prose — a reviewer that omits BOTH the field AND every trace append produces a round indistinguishable from legacy (warn-skip). Prose discipline is exactly what R-5 exists to stop trusting. | Mitigated, not fully closed, within the OQ2 trust budget: (1) FR-166 makes the **deterministic** normalizer self-append its own line — any round where the normalizer actually runs creates the trace file, arming the file-existence prong for the whole task from then on; evasion now requires also skipping the normalizer. (2) FR-180 adds a gate warning when a non-legacy round (`round` present) lacks BOTH trace obligation and a `normalized_by` stamp — the omit-everything posture becomes loud. Full closure (deterministic wrapper per invocation) is R-5b. The binding keying is otherwise sound and is adopted; no better keying exists at rounds_audit-level trust because any reviewer-written marker can be omitted by the same actor — only a deterministic writer breaks the symmetry, which is what (1) contributes. |
| C-3 | US-3 | Exit-3 repair invites post-hoc fabrication: a reviewer told "missing trace, repair and re-gate" can append lines describing invocations that never happened; append-before-report cannot be verified retroactively by a read-only gate. | Accepted at the OQ2 trust level and stated honestly: FR-177 requires the skill to phrase the repair as "run the missed tool (its execution appends the line)" and forbids fabricating a line without invocation — a prose rule, same trust class as `rounds_audit` content itself. The cross-checks (specialist findings referencing `specialist` names, the normalizer's deterministic append, journal corroboration) bound the fabrication surface. Full closure is R-5b. |
| C-4 | US-3 | Fail-closed (exit 2) on an append-forever file is a permanent brick: one corrupt line written in cycle 1 would fail every future round of the task forever, with no repair path (the file is append-only and the gate read-only). | Fail-closed scope is limited to the **current cycle's** lines (FR-173): unparseable/schema-invalid lines within the current cycle → exit 2; corrupt lines from prior cycles → warning only. Mirrors the journal reader's "a corrupt line never masks an earlier valid one" posture without weakening current-round enforcement. |
| C-5 | US-3 | `check-review-convergence.js` is at 474/500 lines; recorded friction says gate scripts keep blowing line budgets. Even "thin dispatch" plus report plumbing may cross 500. | FR-178: all obligation/correspondence/malformed-classification logic lives in `scripts/lib/review/review-trace-rules.js` (pure, dependency-free, same pattern as `review-convergence-rules.js`); the main file gains only a require, one orchestration call, and report fields. If the file still crosses 500, the implementer extracts existing orchestration into the lib rather than trimming the trace check. Depends on `scripts-lib-split` landing first (header note). |
| C-6 | US-2 | §2.5 is mode-dependent (Express/Fast skip unconditionally and silently) — a naive "every round needs a scope-gate line" rule would fail every Express/Fast round. | The scope-gate obligation applies only when `review.json.mode == "full"` (FR-170). In Full mode the line is required with `outcome:"ran"` or `outcome:"skipped"` + `detail:"no-manifest"` — the manifest-absent case is itself evidence, matching the journaled-human-skip design philosophy. |
| C-7 | US-3 | Duplicating cross-runtime evidence into the trace file would create two sources of truth and risk perturbing INV-4's breaker inputs. | Never duplicated (OQ3 binding): cross-runtime claims are corroborated against the existing `briefs/<task>-xruntime.jsonl` read-only (FR-172). The trace mechanism MUST NOT append to, reorder, or reinterpret the journal; `readLatestJournalEntry`/`shouldRefuseDegraded` read exactly what they read today (FR-164, INV-4 check in FR-181). |
| C-8 | US-1 | The gate writing a "trace verified" stamp anywhere would break the read-only guarantee (FR-022/A-2) that roster-qa and the scope gate depend on. | The gate never writes (FR-163). Verification results travel only in the gate's stdout report (`trace` block, FR-176), persisted by roster-review into `briefs/<task>-gate-report.json` per the existing E-2 flow — no new write path. |
| C-9 | US-2 | Adding a file append to `review-normalize.js` changes its side-effect profile from pure-stdout to writer — a consumer invoking it in a read-only context could be surprised. | Precedent already exists in-family: `xruntime-review.js` appends its journal before stdout (FR-095/096), and the D-8 gitignore caveat applies identically. The normalizer's only caller is roster-review §4. The append is best-effort-with-loud-failure (FR-166): append failure is a warning in its output, never an exit change — the normalizer's normalization contract is unchanged. |

## Functional Requirements

#### Trace artifact + schema (US-1)

- **FR-160** [US-1]: The repo MUST ship `schema/review-trace.schema.json` (draft-07) constrained
  to the zero-dep interpreter keyword subset — `type`, `enum`, `required`, `properties`,
  `additionalProperties`, `items` only. Compiling it with the interpreter in
  `scripts/lib/review/finding-schema.js` MUST NOT throw.
- **FR-161** [US-1]: A trace line MUST be a JSON object with required fields
  `schema_version` (enum: `["1.0"]`), `ts` (string, ISO-8601 by convention — not
  schema-enforceable in the keyword subset), `task` (string), `round` (integer),
  `cycle` (integer), `event` (enum: `["scope-gate","normalizer","specialist","cross-runtime"]`),
  `actor` (string — specialist/tool name), `outcome` (enum: `["ran","skipped"]`); optional
  fields `detail` (string) and `digest` (string). `additionalProperties: false`.
- **FR-162** [US-1]: The trace artifact is `briefs/<task>-review-trace.jsonl`: append-only,
  append-forever across cycles (never truncated or rewritten), one line per invocation, each line
  appended **before** the invocation's result is used or reported (append-before-report). The D-8
  briefs/-gitignore caveat applies identically to this file.
- **FR-163** [US-1]: `scripts/check-review-convergence.js` and every module it requires MUST NOT
  write, append to, or delete the trace file, the xruntime journal, or any repo file — the
  read-only guarantee (FR-022/A-2) is preserved unconditionally.
- **FR-164** [US-1]: The trace mechanism MUST NOT modify, append to, or change the read semantics
  of `briefs/<task>-xruntime.jsonl`; `readLatestJournalEntry` and `shouldRefuseDegraded`
  (`scripts/lib/xruntime/xruntime-journal.js`) MUST keep reading exactly the entries they read
  today (INV-4 untouched).

#### Producer wiring (US-2)

- **FR-165** [US-2]: `skills/pipeline/roster-review.md` (v2.2.2 → v2.3.0) MUST instruct trace
  appends at: §2.5 (one `scope-gate` line per Full-mode round — `outcome:"ran"`, or
  `outcome:"skipped"` + `detail:"no-manifest"`; Express/Fast rounds append nothing for this
  event), §3 (one `specialist` line per `specialists_run` entry, `actor` == the entry's `name`,
  appended before the `rounds_audit` entry is composed), and §4 (a `normalizer` line — normally
  satisfied by FR-166's self-append; the skill appends it manually only when invoking a stale
  normalizer that lacks self-append). Each instruction MUST carry a `[ -f … ]` existence check
  (B-4 stale-install pattern).
- **FR-166** [US-2]: `scripts/review-normalize.js` MUST itself append its `normalizer` trace line
  (reusing or extracting the `appendJournalLine` mechanics of
  `scripts/lib/xruntime/xruntime-journal.js`) before emitting its stdout JSON; an append failure
  MUST surface as an explicit warning in its output and MUST NOT be silently healthy (FR-096
  pattern) and MUST NOT change its exit code or normalization output.
- **FR-167** [US-2]: For every new round, the skill contract MUST require the round's
  `rounds_audit` entry to carry `trace_schema_version: "1.0"`, echoing the `schema_version`
  written in that round's trace lines. `schema/review-json-schema.md`'s `rounds_audit[]` shape is
  extended with this field (optional for legacy entries, required prose-side for new rounds).
- **FR-168** [US-2]: Human-skip semantics are preserved: an explicit human skip of the
  cross-runtime pass stays journaled in the xruntime journal exactly as today (`skipped-human`,
  INV-7) — the trace mechanism corroborates it and MUST NOT require or write a duplicate
  `cross-runtime` trace line for it.

#### Gate verification + exit routing (US-3)

- **FR-169** [US-3]: The gate MUST derive trace obligation for the current round as: obligated
  iff `briefs/<task>-review-trace.jsonl` exists, OR the current round's `rounds_audit` entry
  carries a `trace_schema_version` field. When neither holds, or when `review.json` lacks the
  `round` key (B-8 legacy), the gate MUST skip all trace checks with a warning and MUST NOT emit
  any trace violation.
- **FR-170** [US-3]: For a trace-obligated round with **zero** schema-valid trace lines matching
  the current `(cycle, round)`, the gate MUST emit
  `{type:"missing-trace", cause:"process-incomplete"}` → exit 3 (when it is the only violation
  class present, per existing `decideExit` precedence). Required-event coverage for a round with
  lines is: one `normalizer` line; one `scope-gate` line iff `review.json.mode == "full"`; one
  `specialist` line per `specialists_run` entry.
- **FR-171** [US-3]: When ≥1 schema-valid trace line exists for the current `(cycle, round)` but
  a **claimed invocation** lacks its corresponding line — a `specialists_run[].name` with no
  matching `specialist` line, a present `normalized_by` stamp with no `normalizer` line, or a
  Full-mode round with no `scope-gate` line — the gate MUST emit
  `{type:"unattested-invocation", cause:"unattested-invocation", detail:<the claim>}` → exit 1.
  (Zero lines for the round → FR-170's exit 3 instead: an untraced round is "forgot to trace";
  a partially traced round proves tracing was active, so each absent line is an unattested claim.)
- **FR-172** [US-3]: For each `cross_runtime.<runtime>` entry whose `round` equals the current
  round and whose `status` is `healthy`, `degraded`, or `skipped-human`, the gate MUST verify
  read-only that `briefs/<task>-xruntime.jsonl` contains ≥1 entry matching
  `(runtime, config_digest, cycle == current cycle)`; no match →
  `{type:"unattested-invocation", cause:"unattested-invocation"}` → exit 1. `skipped-degraded`
  claims and journal-absent-with-no-claims are not checked. The gate MUST NOT require trace-file
  `cross-runtime` lines (corroborate, never duplicate — OQ3).
- **FR-173** [US-3]: An unreadable trace file (exists but read fails), an unparseable JSON line,
  or a schema-invalid line **whose parseable `cycle` equals the current cycle (or which is
  unparseable at all)** MUST fail closed → exit 2 (degraded input), reported before any
  trace-correspondence conclusion. A corrupt or schema-invalid line attributable to a **prior**
  cycle MUST yield only a warning. A schema-valid line whose `task` field does not match the
  task slug is not counted for correspondence and yields a warning.
- **FR-174** [US-3]: `selectCause` precedence becomes: `unencodable-finding` >
  `unattested-invocation` > `novel-finding-streak` > `round-cap`; `process-incomplete` remains
  never top-level. `schema/review-json-schema.md`'s persisted `no_go_reason.cause` enum gains
  `"unattested-invocation"`.
- **FR-175** [US-3]: Routing (C-1 refinement): on exit 1 with top-level cause
  `unattested-invocation`, roster-review §5.5 MUST set `status: NO-GO` with
  `no_go_reason.type = "review-integrity-failure"` (new enum value in
  `schema/review-json-schema.md`), surface the unattested claims to the human, and route to
  re-running the current round's claimed tooling for real — never to `/roster-spec`
  design-not-converging routing, and never eligible for the streak override.
- **FR-176** [US-3]: The gate report MUST include, on **every** exit code, a `trace` block —
  `{obligated: bool, lines_seen: int, schema_version: "1.0"|null, skipped: bool}` — as the
  anti-stale-script signal (B-4 pattern); roster-review §5.5 MUST check `report.trace` presence
  exactly as it checks `report.config.strikes` and stop on absence ("gate script out of date").
  The existing `config` block is unchanged.
- **FR-177** [US-3]: The §5.5 exit-3 bounded repair loop (2 attempts, unchanged bound) covers
  `missing-trace`: the documented repair is to **actually invoke the missed tool** (whose
  execution appends its line) and re-gate without bumping `round`; the skill MUST NOT instruct
  appending a trace line for an invocation that did not occur (C-3 accepted-trust rule).
- **FR-178** [US-3]: All trace obligation, coverage, correspondence, and malformed-classification
  logic MUST live in `scripts/lib/review/review-trace-rules.js` (pure, dependency-free, exports
  unit-tested rule functions); `scripts/check-review-convergence.js` gains only thin dispatch
  (require + one orchestration call + report/exit plumbing) and MUST remain ≤ 500 lines.

#### Legacy, rollout, non-regression (US-4)

- **FR-179** [US-4]: All existing gate behavior on existing inputs is unchanged: the 17 legacy
  fixtures (keyed on `no_go_round` only) and every existing test in
  `scripts/check-review-convergence.test.js`, `scripts/check-review-convergence-rules.test.js`,
  and `scripts/review-finding-schema.test.js` MUST pass without modification to the fixtures'
  expectations.
- **FR-180** [US-4]: When the current round is non-legacy (`round` present) and NEITHER trace
  obligation holds NOR a `normalized_by` stamp is present, the gate MUST emit a warning naming
  the omit-everything posture (C-2 mitigation) — a warning, never a violation, in v1.
- **FR-181** [US-4]: INV-1..INV-8 (`specs/review-v2-corrections.md`) MUST hold unweakened;
  mechanically: (INV-1/INV-2/INV-5) the normalizer's finding-identity and reopen logic is
  untouched — its test suites pass unmodified; (INV-3) the trace check never alters
  round/cycle derivation — `review-lifecycle.js` untouched; (INV-4) `shouldRefuseDegraded` and
  `readLatestJournalEntry` byte-untouched and their tests pass unmodified; (INV-6)
  `scripts/xruntime-exec.sh` byte-identical (FR-086); (INV-7) the `skipped-human` shape is
  unchanged and corroborated per FR-172; (INV-8) streak-override routing is untouched and the
  new `unattested-invocation` cause is never override-eligible (FR-175).

## Acceptance Criteria

- AC-1 [US-1 happy path]: `schema/review-trace.schema.json` compiles under the zero-dep
  interpreter and accepts/rejects lines per FR-161 → CHECK-1 passes.
- AC-2 [US-2 happy path]: a Full-mode round leaves scope-gate + per-specialist + normalizer
  lines, appended before `rounds_audit` composition → CHECK-2/CHECK-3 pass.
- AC-3 [US-2, C-9]: normalizer trace-append failure surfaces as a warning in its output, exit
  code and normalization output unchanged → CHECK-3 covers the failure fixture.
- AC-4 [US-3 happy path]: fully corroborated round → gate exit 0 with `trace` block present
  → CHECK-4.
- AC-5 [US-3]: trace-obligated round, zero current-round lines → exit 3 `missing-trace` →
  CHECK-4.
- AC-6 [US-3, C-1]: partial trace with an unclaimed specialist / stamped-but-untraced
  normalizer / Full-mode missing scope-gate line → exit 1, top-level cause
  `unattested-invocation` → CHECK-4.
- AC-7 [US-3, C-4]: current-cycle malformed line → exit 2; prior-cycle malformed line →
  warning only, verdict unaffected → CHECK-4.
- AC-8 [US-3, C-7]: cross-runtime claim without a matching journal entry → exit 1; matching
  entry → no violation; journal file itself never modified by a gate run → CHECK-5.
- AC-9 [US-4]: legacy round-less file and pre-mechanism round both warn-skip; versioned entry
  without file exits 3; file without versioned entry is obligated → CHECK-6.
- AC-10 [US-4, C-2]: all pre-existing gate/rules/schema/normalizer/journal tests pass
  unmodified; `check-review-convergence.js` ≤ 500 lines → CHECK-7/CHECK-8.
- AC-11 [US-2]: roster-review.md carries the producer instructions with existence checks and
  the version bump to 2.3.0 → CHECK-9.

## Edge Cases

- EC-1 [US-3]: Trace file exists but contains only prior-cycle lines → round is obligated (file
  prong), zero current-round lines → exit 3 `missing-trace` (FR-170), not a legacy skip.
- EC-2 [US-3]: One corrupt line appended in cycle 1; task is now in cycle 3 → warning only; the
  current cycle's valid lines are evaluated normally (FR-173, C-4).
- EC-3 [US-3]: Duplicate trace lines for the same specialist in one round → valid (append-only
  re-runs happen); correspondence requires ≥1 match, never exactly 1.
- EC-4 [US-3]: Empty trace file (exists, zero bytes) → obligated via file prong, zero lines →
  exit 3.
- EC-5 [US-3]: Trace line with `task` ≠ the task slug inside the per-task file → not counted,
  warning (FR-173) — never silently treated as evidence.
- EC-6 [US-2]: Express/Fast round → no scope-gate line required or expected (C-6); specialist
  and normalizer obligations still apply when the round is trace-obligated.
- EC-7 [US-3]: `rounds_audit` entry absent entirely for the current round → the existing
  `missing-loopback-audit` process-incomplete fires (unchanged); trace obligation falls back to
  the file-existence prong alone for that gate run.
- EC-8 [US-3]: Round 1 of a fresh cycle on a task whose trace file exists from prior cycles →
  obligated; required events are evaluated against round 1's own claims (`specialists_run` of
  round 1's entry, mode, `normalized_by`).
- EC-9 [US-3]: Exit-3 repair re-gate after actually running the missed tool → line now present,
  gate re-run inside the existing 2-attempt bound, `round` not bumped (FR-177).
- EC-10 [US-4]: A stale installed gate script that predates this spec → its report lacks the
  `trace` block; roster-review §5.5 stops with "gate script out of date" (FR-176) instead of
  silently passing untraced rounds.
- EC-11 [US-3]: `--static` mode → trace checks still run in full (they are pure file reads, no
  scratch-tree execution); only red/green verification is skipped, exactly as today.

## Runnable Checks

(Red-command convention: exit 0 = passes, 1 = assertion fired, ≥2 = error. CHECK-2/3/4/5/6 name
test files this task must create; they are the red-run ratchet candidates.)

- CHECK-1 [AC-1]: `node --test scripts/review-trace-schema.test.js` → interpreter compiles the
  schema without throwing; conforming line valid; missing-`event` and out-of-enum lines rejected
  with field paths; asserts the schema file uses no keyword outside the supported six.
- CHECK-2 [AC-2]: `node --test scripts/review-trace-rules.test.js` → pure-rule coverage:
  obligation prongs (FR-169), required-event coverage per mode (FR-170), claim correspondence
  (FR-171), cycle-scoped malformed classification (FR-173), EC-1..EC-8 fixtures.
- CHECK-3 [AC-2, AC-3]: `node --test scripts/review-normalize-trace.test.js` → normalizer
  self-append lands before stdout emission; `EACCES` fixture yields a warning in output with
  unchanged exit code and unchanged normalization result (FR-166).
- CHECK-4 [AC-4, AC-5, AC-6, AC-7]: `node --test scripts/check-review-convergence.test.js` →
  end-to-end gate fixtures added for exits 0/3/1/2 per AC-4..AC-7, including `trace` block
  presence on every exit (FR-176) and `selectCause` precedence with `unattested-invocation`
  (FR-174).
- CHECK-5 [AC-8]: same suite, cross-runtime fixtures → journal-corroboration hit/miss (FR-172);
  test asserts the journal file's bytes are identical before/after the gate run (FR-163/FR-164).
- CHECK-6 [AC-9]: same suite, rollout fixtures → legacy warn-skip, pre-mechanism warn-skip,
  versioned-no-file exit 3, file-no-version obligated (FR-169, FR-179 skip wording).
- CHECK-7 [AC-10]: `npm test` → the full suite, including all pre-existing gate/rules/schema/
  normalizer/journal tests unmodified (FR-179, FR-181) and the bundled `check:*` linters
  (re-run `scripts/sync-harness.sh` and stage every regenerated projection).
- CHECK-8 [AC-10]: `node -e "const n=require('fs').readFileSync('scripts/check-review-convergence.js','utf8').split('\n').length; process.exit(n<=500?0:1)"`
  → main gate file stays within the 500-line budget (FR-178).
- CHECK-9 [AC-11]: `node -e "const s=require('fs').readFileSync('skills/pipeline/roster-review.md','utf8'); const ok=/version:\s*2\.3\.0/.test(s) && (s.match(/review-trace/g)||[]).length>=4 && /trace_schema_version/.test(s); process.exit(ok?0:1)"`
  → producer wiring present in the skill with the version bump (FR-165, FR-167).

## Entities

- `TraceLine`: one JSONL entry in `briefs/<task>-review-trace.jsonl` — schema
  `schema/review-trace.schema.json` (FR-161); self-reported evidence that one reviewer tool
  invocation occurred, appended before its result is used.
- `briefs/<task>-review-trace.jsonl`: per-task append-only, append-forever trace artifact
  (FR-162); sibling of — never merged with — the xruntime journal.
- `TraceObligation`: the gate-derived boolean deciding whether trace checks apply to the current
  round — trace file exists OR `rounds_audit` entry carries `trace_schema_version` (FR-169).
- `trace_schema_version`: new `rounds_audit[]` entry field ("1.0"), the skill-contract marker
  that a round was produced trace-aware (FR-167); echoed as `schema_version` in trace lines.
- `missing-trace`: gate violation type, `cause: "process-incomplete"` → exit 3 — a
  trace-obligated round with zero current-round lines (FR-170).
- `unattested-invocation`: gate violation type AND new top-level cause → exit 1 — a claimed
  invocation with no corresponding trace/journal line on a partially traced round
  (FR-171/FR-172/FR-174).
- `review-integrity-failure`: new `no_go_reason.type` value carrying the C-1 routing refinement
  (FR-175) — re-run the round's tooling; never design-not-converging routing.
- `trace` block: the gate report's anti-stale signal, present on every exit (FR-176).
- `R-5b`: deferred residual — deterministic wrapper-per-specialist appending trace lines itself
  (xruntime-review.js-level trust) — see Residuals.

## Residuals

- **R-5b (deferred, named per OQ2):** per-specialist deterministic invocation wrappers that
  append the trace line themselves (closing C-2's omit-everything evasion and C-3's post-hoc
  fabrication entirely). Not built in v1 — requires human sign-off on the cost of wrapping every
  specialist spawn. Graduation signals: FR-180 warnings recurring in practice, or an exit-3
  repair observed to fabricate rather than re-run.
- **QA-phase traces:** out of scope here as for the convergence mechanism generally (standing
  residual from `specs/pipeline-loop-convergence.md`).
- **Distribution gap:** the new schema + lib module + test files join the standing
  installed-project distribution follow-up (R-6 family); invocation lines carry existence checks
  (B-4) as interim protection.

## Open Points (need human validation)

1. **C-1 routing refinement** — new `no_go_reason.type = "review-integrity-failure"` and cause
   `unattested-invocation` extend two documented enums and add a §5.5 routing branch that
   roster-run must treat as non-spec-routing. This deviates from a literal reading of the OQ1
   decision (which named only exit codes, not routing); exit codes themselves are exactly as
   decided.
2. **FR-166 normalizer self-append** — extends an existing deterministic helper's side-effect
   profile (stdout-only → stdout + trace append). Judged inside the OQ2 "prefer the helper model
   where a helper already exists" clause, not a new wrapper; confirm this reading.
3. **FR-180 warning** — the omit-everything posture is warn-only in v1; confirm that warn (not
   fail) is the intended rollout posture until R-5b.
4. **`scripts-lib-split` sequencing** — this spec's `scripts/lib/review/…` paths assume the
   split lands first; if ordering flips, paths degrade to `scripts/lib/` with the split carrying
   them (header note).
