---
name: roster-review
description: Performs a fix-first code review with conditional specialists and a GO/NO-GO verdict.
when_to_use: "Use after roster-implement completes, before QA. Trigger: 'review this', 'roster-review'."
version: 2.3.0
domain: pipeline
phase: review
preamble: true
friction_log: true
allowed_tools: [Read, Edit, Write, Bash, Agent, Skill, AskUserQuestion]
human_gate: after
requires_review_bundle: ">=1.4.0"
tunables:
  auto_fix_threshold_lines: 20
  always_run_spec_compliance: true
  max_no_go_rounds: 5
  novel_finding_strikes: 2
  cross_runtime_probe_timeout: 120
artifacts:
  reads:
    - briefs/<task>-impl.md
    - briefs/<task>-reviewer.md
    - briefs/<task>-review.json (prior round, if present — cumulative findings + no_go_round source)
    - git diff (current)
  writes:
    - briefs/<task>-review.json
    - briefs/<task>-review-trace.jsonl (append-only invocation trace, R-5 gate-enforced — specs/r5-trace-enforcement.md)
pipeline_role:
  triggered_by: /roster-implement completed
  receives: briefs/<task>-impl.md + current diff
  produces: briefs/<task>-review.json GO or NO-GO
---

# Roster Review

You conduct a structured, fix-first review. Mechanical corrections are applied without asking. Ambiguities are grouped into one question. You produce a structured JSON verdict.

**Golden rule:** every claim must cite the file and line. Never "probably" or "likely".

Deterministic mechanics live in tools, not in this prose: `scripts/check-scope-diff.sh` (scope gate),
`scripts/check-review-convergence.js` (ratchet + convergence gate), `scripts/xruntime-review.js`
(cross-runtime probe/journal), `scripts/review-normalize.js` (finding validation/dedup), and
`schema/review-json-schema.md` (the full `briefs/<task>-review.json` shape). This skill covers
orchestration, judgment, and the human gate.

## Mode Awareness

**Read the mode from `briefs/<task>-impl.md`** (field `mode: express|fast|full`). If absent, infer from context.

| Mode | Review scope | Specialist invocation | Escalation check |
|---|---|---|---|
| **Express** | Correctness + security only. Skip spec/KB compliance — no spec impact expected. | `reviewer` agent only. Skip `spec-compliance`, `code-quality-auditor`, `architect` unless diff > 5 files. | Mandatory — see below |
| **Fast** | Full review. Spec/KB compliance only if KB exists. | `reviewer` + conditionals per normal rules. | Mandatory — see below |
| **Full** | Full review. All specialists per normal rules. | All conditionals apply. | N/A |

### Mode Escalation Check (Express and Fast only)

After reading the diff, check for signs the task scope exceeded its mode:

| Signal | Escalation |
|---|---|
| New public API, interface, or exported function | Recommend upgrading to Full (spec needed) |
| Behaviour change affecting callers beyond the reported fix | Recommend upgrading to Full |
| Design decision made implicitly in the code (no brief, no spec) | Recommend upgrading to Fast if Express, or Full if Fast |
| Spec or KB update is clearly needed but was not done | Flag as `escalation_needed: true` in verdict |

If escalation is needed: set `escalation_needed: true` and `escalation_reason`. **Do not block GO** — it is informational; the human decides whether to loop back.

## Input Contract

**Bundle preflight (F-4 — input-contract abort, not a verdict):**

```bash
node scripts/review-bundle-verify.js
```

Before reading any input: run this. On any problem, stop immediately — before writing
`review.json`, before any ledger event, no new verdict status. Print exactly: "stale-install:
the review-tool bundle is missing or out of date. Fetch review-bundle-install.sh from a trusted
roster source, run its install or upgrade mode with --from-raw <url> (or --from-checkout <dir>),
then /recruit update." Never proceed past this line degraded.

Read in order:
1. `briefs/<task>-reviewer.md` — context and points of attention
2. `briefs/<task>-impl.md` — modified files and decisions made
3. `git diff main...HEAD` — the complete diff

If `briefs/<task>-impl.md` is absent: ⛔ stop — review cannot start without the implementation scope.

`briefs/<task>-reviewer.md` is absent by design in Express/Fast mode. Do not block — proceed from the impl brief and diff alone.

## Steps

### 1. Read the diff

```bash
git diff main...HEAD
git log main...HEAD --oneline
```

Read each modified file in its entirety — not just the diff lines.

### 2. Fix-first: auto corrections

Apply the following mechanical corrections without asking:

| Category | Examples | Auto-fix threshold |
|---|---|---|
| Dead code | Unused variables, unused imports | Always |
| Magic numbers | Inline constants → named constants | Always |
| Stale comments | Comments that contradict the code | Always |
| Style / format | Local style inconsistencies, trailing whitespace | Always |
| Obvious DRY | Identical copy-paste block 3+ lines | If < `tunables.auto_fix_threshold_lines` |

**Do not auto-fix:**
- Security (auth, injection, XSS) → always in findings
- Race conditions → always in findings
- Visible behavior changes → always ask
- Refactors > `tunables.auto_fix_threshold_lines` lines → always ask

After each auto-fix, verify that quality gates still pass.

### 2.5 Deterministic scope gate

Runs **after** auto-fixes, so the gated state is the state that ships. **Branch on mode first**
(from `briefs/<task>-impl.md`): in **Express/Fast**, skip this gate unconditionally and silently —
even if a stale `briefs/<task>-manifest.txt` exists. Only in **Full mode** continue:

```bash
[ -f "briefs/<task>-manifest.txt" ] && echo "manifest: present" || echo "manifest: absent"
```

- **Manifest present** → run the gate script:
  ```bash
  bash scripts/check-scope-diff.sh "briefs/<task>-manifest.txt"
  ```
  Exit 0 → no violations. Exit 1 → stdout is a JSON array of findings (`severity: HIGH`,
  `category: "scope"`, `line: 0`) — merge them **verbatim** into `findings`. Any OPEN scope finding
  sets `status: NO-GO` with `no_go_reason.type = "out-of-scope-change"`. A human may ACCEPT a scope
  finding in the grouped ambiguity pass (step 5) — acceptance is the scope escape hatch. Exit 2
  (manifest malformed) → treat as absent below.
- **Manifest absent** (Full mode — corroborated by `briefs/<task>-implementer.md` existing) → emit
  one MEDIUM informational finding "scope gate skipped — no manifest"; never NO-GO for this.

Auto-fixes (step 2) must stay within manifest entries when a manifest is present — this gate runs
after them and flags any excursion regardless of author. A task edit to a pre-task-dirty file is
excluded by design; a mid-phase third-party file is attributed to the task and must be
human-ACCEPTED (documented blind spots, see the script).

**Invocation trace (R-5, FR-165):** Full mode only, append one `scope-gate` line — `ran` if the
manifest was present, else `skipped`/`no-manifest` (Express/Fast append nothing, EC-6):

```bash
[ -f scripts/lib/review/review-trace.js ] && node scripts/lib/review/review-trace.js --task <task-slug> --round <round> --cycle <cycle> --event scope-gate --actor check-scope-diff.sh --outcome <ran|skipped> [--detail no-manifest] || echo "review-trace.js missing — stale install"
```

When spawning the `reviewer` agent (step 3), state whether this gate ran — when it did, the agent
defers scope assessment to it and emits no scope findings of its own.

### 3. Conditional specialists

Spawn specialists based on scope. Each receives: the complete diff, `briefs/<task>-reviewer.md`,
their own instructions (path below), and whether the scope gate (§2.5) ran.

**Uncommitted-tree work:** capture the pre-task tree state (`git diff --stat` + `git status`
recorded at task start) and pass it to every specialist, so scope-discipline claims are verifiable
without session history.

| Specialist | Condition | Path / Invocation |
|---|---|---|
| `spec-compliance` (per-feature) | `specs/<task-slug>.md` exists | Invoke `spec-compliance-auditor` with spec path as `$ARGUMENTS` |
| `spec-compliance` | Always if KB exists (`kb/spec.md` present) | Skill — read `skills/kb/spec-compliance-auditor.md` and invoke via `Skill` tool or spawn as sub-agent with this content |
| `code-quality-auditor` | Always if KB exists (`kb/properties.md` present) | Skill — read `skills/kb/code-quality-auditor.md`; provide diff + `kb/properties.md` + `kb/glossary.md` + reviewer.md |
| `architect` | Medium or large blast radius (>3 files modified or public module) | `.claude/agents/architect.md` |
| TUI pass (via `reviewer`) | TUI scope detected in diff or brief | Spawn the `reviewer` agent with a TUI checklist appended: rendering at 80x24/120x40/220x50, keyboard navigation paths, terminal-capability fallbacks, escape-sequence hygiene. (Deterministic tmux verification happens later in `/roster-qa`.) |
| `reviewer` (agent) | Always | `.claude/agents/reviewer.md` |
| `cross-runtime-reviewer` | **Mandatory** in Fast/Full when a runtime CLI other than the host is on `PATH` (`codex` or `opencode`); skip only by explicit human decision | See **Cross-Runtime Review** below |

#### Delta-Scoped Loop-Back Reviewer Selection

This table governs round 1. On a loop-back round (physical `round` ≥ 2), narrow selection per
below — safe because the ratchet + every-round gate (§5.5) hold the floor regardless of which
specialists re-run.

**Round 1, or legacy `review.json` missing `round`.** Apply the table above unchanged. A missing
`rounds_audit` entry here downgrades to a warning, not a violation.

**Loop-back rounds — `round` ≥ 2:**

- The owner `reviewer` agent **always** re-runs.
- A specialist re-runs **iff** it is named in an OPEN finding's `specialist` field, **or** a
  trust-boundary surface (authority, custody, isolation, publication) changed since the round's
  `reviewed_sha`. Otherwise it sits out this round.
- Cross-runtime participation on loop-back rounds is governed exclusively by the circuit-breaker
  state below — this table's cross-runtime row does not apply here.
- **Full fan-out** (every specialist, plus the cross-runtime pass when healthy) re-triggers when
  either: the correction changes public behavior/authority/custody/isolation/publication semantics
  (record the judgment in `selection_reason`); or the **immediately preceding round** recorded a
  strike — the anti-starvation rule: strike 2 of a two-strike escalation is always measured under
  full scrutiny, never narrowed away by delta selection.
- **Deduped findings:** when two findings converged on one shared invariant and only one specialist
  survives the dedup (§4), that surviving specialist's name is what selection keys on.

**Invocation trace (R-5, FR-165):** before composing `rounds_audit`, append a `specialist` line
per specialist, `actor` == its name:

```bash
[ -f scripts/lib/review/review-trace.js ] && node scripts/lib/review/review-trace.js --task <task-slug> --round <round> --cycle <cycle> --event specialist --actor <specialist-name> --outcome ran || echo "review-trace.js missing — stale install"
```

Append **one entry per round — including GO drafts** — to `rounds_audit` (append-only, carried
forward, **retained on GO**) before invoking the gate (§5.5), with `round`, `reviewed_sha`,
`fix_sha` (or `null` + `fix_sha_reason: "dirty-tree"`), `specialists_run: [{name,
selection_reason}]` (every entry needs a non-empty reason — "why did this specialist run this
round" must always be answerable), `strike` (populated **after** the gate reports it, §5.5 —
never computed here), and `trace_schema_version: "1.0"` (required for new rounds, FR-167). Full
shape: `schema/review-json-schema.md`.

### Cross-Runtime Review

When a different runtime CLI is available, run an independent adversarial pass — **mandatory** for
Fast/Full when a second runtime is on `PATH`, skippable only by explicit human decision (record it
in the verdict if skipped).

Invoke the helper — it owns the wrapper subprocess, exit-code corroboration, output validation,
`config_digest`, the invocation journal, and the probe-once/degrade-once breaker state. Write the
diff + `briefs/<task>-review.json` to a scratch file and pass its path as `--prompt-file` (never
positional — INV-6, a large diff can exceed a shell argv limit):

```bash
[ -f scripts/xruntime-review.js ] && node scripts/xruntime-review.js codex --task <task-slug> --prompt-file <scratch-file> --round <round> --cycle <cycle> [--write] [--timeout <tunables.cross_runtime_probe_timeout>] || echo "xruntime-review.js missing — stale install"
```

Instruct it to return **only findings the primary missed**, in the standard finding schema with
`specialist: "<runtime>-xruntime"`. Verification prompts must state claims in **behavioral terms**
— disputes over phrasing are not findings.

The helper's JSON result is `{status, reason, config_digest, findings[], journal_line}`.
`status: "healthy"` → merge `findings[]` into `cross_runtime_findings` (the normalizer, step 4,
canonicalizes and dedupes this array at intake — INV-5/E-7; augment-only and never rewritten
thereafter) and persist the digest/round into `cross_runtime`. `status: "degraded"` →
discard the run's output entirely (it can never contribute a novel finding); persist the
degradation with its `reason` (`spawn-error` is a distinct pre-runtime transport failure, never
`empty-output`). `status: "skipped-degraded"` → the breaker refused a re-probe this cycle (never a
permanent ban — a fresh cycle, i.e. prior GO or no prior file, always re-probes). `status:
"skipped-human"` → an explicit human decision to skip, already journaled — carries
`{actor, round, ts}`; persist it into `cross_runtime.<runtime>` as
`{status:"skipped-human", reason, config_digest, round, ts, actor}` (schema/review-json-schema.md)
— it can never arm the breaker. `status: "blocked"` (`reason: "malformed-verdict"`) → the prior
verdict was unreadable; fail closed, surface it to the human, never treat as fresh/no-state.

**Precedence** (highest first): a degraded runtime never re-runs within or after the round it
degraded, short of a digest change or `--human-retry`. Round 1 or a full-fan-out round runs a
healthy runtime unconditionally. A delta (loop-back, non-full-fan-out) round runs a healthy runtime
only if it owns an OPEN finding it originally raised.

**GO authority:** any `cross_runtime_findings` entry that is CRITICAL or HIGH (OPEN) sets
`status: NO-GO` with `no_go_reason.type = "cross-runtime-finding"`. When such an entry drives the
NO-GO, mirror it into primary `findings` (gaining the round-tracking fields, `first_seen_round` =
this round) so it enters the ratchet — the `cross_runtime_findings` original is never edited.

**Gate warning:** the convergence gate structurally warns when a `degraded` `cross_runtime` entry
lacks `reason` or `config_digest` — surface it verbatim in the human-gate one-liner (§7); it means
the breaker's bookkeeping is incomplete, not that a finding was missed.

**KB-conditional check:** `[ -d kb ] && [ -f kb/properties.md ] && echo "KB present" || echo "KB absent"`

If KB is present, `code-quality-auditor` findings are merged into the review table. Critical KB
violations are auto-classified as HIGH severity.

When findings have `category: "spec"` and severity CRITICAL or HIGH: set
`no_go_reason.type = "spec-ac-failure"` and populate `no_go_reason.failed_acs` from each finding's
`acs` array (`AC-N`/`FR-NNN` for a `specs/<task-slug>.md` contract, `S<N>` claim ids for `kb/spec.md`).

**Expected findings format from each specialist** (validated against
`schema/review-finding.schema.json`):

```json
{
  "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO",
  "confidence": 1-5,
  "path": "file/path.ml",
  "line": 42,
  "category": "correctness|security|architecture|ux|spec|style|scope",
  "summary": "Short problem description",
  "evidence": "File X line Y — exact code quote",
  "fix": "What to do",
  "fingerprint": "path:line:category",
  "specialist": "architect|reviewer|spec-compliance|reviewer-tui|scope-gate"
}
```

### 4. Normalize and deduplicate

Run the normalizer over every specialist's raw findings plus the prior cumulative ledger, passing
the LAST persisted `briefs/<task>-gate-report.json` if one exists (absent on round 1):

```bash
[ -f scripts/review-normalize.js ] && node scripts/review-normalize.js <specialist-files...> --ledger <(echo "$PRIOR_FINDINGS") --round <round> --cycle <cycle> --task <task-slug> --gate-report briefs/<task>-gate-report.json --prior briefs/<task>-review.json || echo "review-normalize.js missing — stale install"
```

It validates each new finding, canonically fingerprints it (plus `fid`, E-3), merges exact
duplicates by SEMANTIC identity — a shared v1 fingerprint with a different summary/v2 field is
NEVER merged, only listed as a `probable_duplicate` for your adjudication (INV-1) — and
canonicalizes/dedupes cross-runtime findings within their own array (see above). A re-report
matching the ledger is disposed into `reobservations[]` (confirmed noise — no false novel-finding
strike), `dispositions.reopened[]` (a RESOLVED, check-linked entry the gate report shows failed, or
any RESOLVED entry with no linked check at all — INV-2: flip its `status` back to `OPEN`, set
`resolved_round: null`, and stamp `reopened_from_round`/`reopened_at_round` from the entry it
returns), or `dispositions.pending_check[]` (a RESOLVED, check-linked entry the report doesn't
cover yet — resolve it after THIS round's gate run from THIS round's fresh report, one bounded
re-gate if it turns out to be a reopen, §5.5). Schema-invalid input lands in `rejected[]` with a
reason — never silently dropped. `--prior` also gets the caller's `--round` cross-checked against
the lifecycle witness (§5.5); a mismatch lands in `warnings[]` — surface it in the one-liner (§7),
never silently proceed on a drifted round. Merge its output into the draft verdict; stamp
`normalized_by` with its `normalizer_version`.

**Invocation trace (R-5, FR-165/FR-166):** given `--task`/`--round`/`--cycle` above, the normalizer
self-appends its `normalizer` line — no manual append needed. Surface any `review-trace append
failed` warning in the one-liner (§7). Append by hand only for a stale normalizer predating
FR-166:

```bash
[ -f scripts/lib/review/review-trace.js ] && node scripts/lib/review/review-trace.js --task <task-slug> --round <round> --cycle <cycle> --event normalizer --actor review-normalize.js --outcome ran || echo "review-trace.js missing — stale install"
```

### 5. Group ambiguities

Collect all findings that require a human decision (severity HIGH+ on behavior changes, security, design).

Present in **one single** `AskUserQuestion`:

```
I have questions on [N] points before finalizing the review:

1. [path:line] — <finding summary> — <option A vs option B>
2. [path:line] — ...

For each point: A, B, or free-form answer.
```

Never ask multiple separate questions. One single pass.

> **Deliberate override:** the preamble's *Asking Questions* rule ("one question at a
> time") does not apply to findings triage — a review's ambiguities are one decision
> batch, and drip-feeding them wastes the human's attention. This grouped ask is the
> only sanctioned exception; everywhere else in this skill the preamble rule stands.

### 5.5 Invariant ratchet + convergence gate

Runs on **every** verdict emission of every round, GO included — the ratchet is enforced most
strictly on the round that ends the loop. Full field shapes: `schema/review-json-schema.md`.

**Cumulative findings.** Read the prior `briefs/<task>-review.json` if it exists. `findings` is
cumulative: carry every prior entry forward **verbatim**, updating only `status` and the
round-tracking fields — never re-derive a fingerprint or drop an entry the normalizer didn't
re-report this round. **Reset `findings` to empty on a GO verdict**, after promoting checks below.

**The ratchet rule.** A HIGH+ finding whose `resolved_round` is greater than `first_seen_round`
(it survived at least one loop-back) MUST carry a non-null `check` before RESOLVED. Exempt: same-
round raise+resolve, and human-`ACCEPTED` findings. Two findings revealing the same invariant may
share one check. The implementer declares each new check in a `## Ratchet` section of
`briefs/<task>-impl.md` (finding reference, check path, red command, `check_encodable` + reason if
false) — read it to populate the corresponding finding's fields; do not infer a check path from the
diff. A `check` is always a node-runnable file path (invoked as `node <path>`); a spec-level
`CHECK-N` id with no file is recorded for traceability but not red/green-executed.

**ACCEPT prompt.** When the human ACCEPTs a HIGH+ finding in step 5, state that acceptance
**permanently waives** the invariant — never phrase it as "skip for now".

**Two-event lifecycle (INV-3).** The physical `round` counter follows exactly two events, stated
once here and nowhere else with different words: (1) a persisted GO verdict retains its cycle-final
`round`/`rounds_audit`/`cross_runtime` for auditability — nothing resets in place; (2) the next
review cycle then initializes fresh — round 1, full fan-out, empty `rounds_audit`, a new
cross-runtime probe, and `cycle` incremented. Never re-derive this by hand — shell out to the
executable witness at draft composition:

```bash
node scripts/lib/review/review-lifecycle.js --prior briefs/<task>-review.json
```

→ `{round, cycle, fresh_cycle}` (absent prior file is legitimate input — a fresh task). A repaired
draft re-gated after an exit-3 violation does **not** re-invoke this (`round` doesn't bump again).
**Two counters, never conflated:** `no_go_round` (reset to 0 on GO, incremented on a finding-driving
NO-GO outside `category: "scope"`, compared against `tunables.max_no_go_rounds`) is the
qualifying-only round-cap backstop — separate from `round`.

**Two-strike novel-finding escalation.** Pass `tunables.novel_finding_strikes` to the gate as
`--strikes`. The gate computes the current round's strike — a physical round ≥ 2 with ≥1 novel
HIGH+ non-scope, non-ACCEPTED, non-same-round-resolved finding, OR ≥1 HIGH+ finding this round
reopened (`reopened_at_round == round`, E-4: a regression-heavy loop-back round strikes too; round
1 never strikes) — persist it into this round's `rounds_audit` entry. **Human override (streak
only):** when the gate's `cause` is `novel-finding-streak`, offer an explicit "override — one more
implement round" option alongside the default `/roster-spec` routing; if exercised, record
`streak_override: {round, by: "human"}` and route to `/roster-implement` instead — the GATE itself
is override-aware (E-1: a `streak_override` valid for the CURRENT round forces that round's
`strike: false` instead of recomputing it, so a later `--static` re-check, e.g. by roster-run,
still passes) — a **new** streak must fully re-accumulate before the option returns; staleness is
current-round-only (the next verdict's `round` increment retires it). The round-cap escalation is
**never** overridable.

**`pre_fix_sha`.** At NO-GO emission, for each new HIGH+ finding this round: if the tree is clean,
`pre_fix_sha` = current HEAD; if dirty, `pre_fix_sha` = `null` with `"dirty-tree"` — never record a
confidently wrong SHA. When null, `red_verified` stays null; flag it in the one-liner (§7).

**Gate invocation — fixed order.** Compose the full draft (including this round's `rounds_audit`
entry and any `cross_runtime` updates) and write it to a `.draft` suffix BEFORE invoking:

```bash
node scripts/check-review-convergence.js briefs/<task>-review.json.draft --max-rounds <tunables.max_no_go_rounds> --strikes <tunables.novel_finding_strikes> --timeout 120
```

This runs full mode: red/green verification for any check needing it, JSON report on stdout.
Before trusting any other field, check `report.config.strikes` **and** `report.trace` (FR-176) are
both present — absence of either means a stale gate script; do not persist, surface "gate script
out of date", and stop.

**Exit-3 bounded repair loop.** Exit 3 means the only violations are `process-incomplete` — an
incomplete/absent `rounds_audit` entry, **or** `missing-trace` (a trace-obligated round with zero
current-round trace lines, FR-170) — a process defect, not design. Repair per
`violations[].detail`, bounded to 2 attempts, never bump `round`: repair the entry for
`missing-loopback-audit`; for `missing-trace`, **actually invoke the missed tool** (§2.5/§3/§4
appends the line) — **never** fabricate one (FR-177/C-3). Still exit 3 after 2 attempts → stop,
surface to the human — never design-not-converging.

Once the gate reports anything other than exit 3, merge `checks[]` (`red_verified`, `check_blob`,
keyed by `(check, fid)` — E-3) back into findings, merge `current_round_strike` into this round's
`rounds_audit.strike`, and merge the outcome into the verdict: exit 0 → no change. Exit 2 →
degraded input — fail-closed: block the route-back, surface to the human. **Exit 1 → NO-GO
regardless of step 6**, split by `cause` (C-1/FR-175): `unattested-invocation` → `type =
"review-integrity-failure"`, same `cause` — surface the unattested claims, route to re-running the
claimed tooling, never `/roster-spec`/streak-override (INV-8). Any other cause →
`"design-not-converging"` (precedence unencodable-finding > unattested-invocation >
novel-finding-streak > round-cap, FR-174) — even on an otherwise-GO round.

**Gate-report persistence + pending-check resolution (E-2).** Persist the gate's stdout JSON
verbatim to `briefs/<task>-gate-report.json` (overwritten each round — it already has the report,
this is a straight write, no re-execution). Step 4's `dispositions.pending_check[]` entries were
provisional (last round's report didn't yet cover their check); resolve them now from THIS round's
freshly persisted report: covered + `red_verified: true` → reobserved (metadata only); otherwise →
reopen (§ step 4's reopen mutation). A reopen mutation discovered here changes strike/violation
inputs, so re-invoke the gate exactly once more on the corrected draft (bounded — this is not the
exit-3 repair loop) before the write below.

Only then write `briefs/<task>-review.json` **once** (never before the gate has run and merged) and
remove the `.draft` file — no half-written state, no orphan drafts.

**GO-verdict promotion.** Before resetting `findings` on GO, promote every `red_verified: true`
check to a permanent home: append it as a new `CHECK-N`/`AC-N` pair in `specs/<task-slug>.md` if it
exists, otherwise it stays an ordinary test (post-GO weakening protection then degrades to normal
test discipline).

### 6. Write the verdict

Produce `briefs/<task>-review.json` per `schema/review-json-schema.md` — `task`, `date`, `status`,
`auto_fixes_applied`, `findings` (base shape: `schema/review-finding.schema.json`, plus the
round-tracking fields), `cross_runtime_findings`, `summary`, `no_go_reason`, `no_go_round`, `round`,
`cycle`, `rounds_audit`, `cross_runtime`, `streak_override`, `mode`, `escalation_needed`,
`escalation_reason`, `normalized_by`.

**GO status if:** no CRITICAL or HIGH OPEN finding in either `findings` or `cross_runtime_findings`,
AND the convergence gate (§5.5) reports no violation.
**NO-GO status if:** at least one such finding not resolved/accepted, OR the gate reports a
violation. A cross-runtime CRITICAL/HIGH sets `type = "cross-runtime-finding"`; a gate violation
with `cause == "unattested-invocation"` sets `type = "review-integrity-failure"` (FR-175); any
other gate violation sets `"design-not-converging"` with `cause` per §5.5.

### 7. Human gate

Present a one-line summary: auto-fixes applied, finding counts by severity, GO/NO-GO status,
`no_go_round` and the checks added this round (e.g. "round 2/5, 1 new ratcheted check
(`checks/foo.test.js`, red-verified)"). If a finding's `pre_fix_sha` is null, flag it explicitly. If
NO-GO, name the HIGH+ findings to resolve. Surface any gate `warnings[]` verbatim. Wait for
explicit human confirmation before proceeding.

**Streak-escalation override.** When `no_go_reason.cause == "novel-finding-streak"`, present the
override option (§5.5). Never offer it for `cause == "round-cap"` — non-overridable.

**Known residual:** the review-GO → QA-NO-GO → implement loop is not bounded by the convergence
gate — `/roster-qa` is explicitly out of scope for this mechanism.

## Output Contract

`briefs/<task>-review.json` with GO or NO-GO status and all findings documented.

**If GO:** `/roster-qa` can start. **If NO-GO:** return to `/roster-implement` with OPEN findings. **If `no_go_reason.type == "spec-ac-failure"`:** return to `/roster-spec`. **If `"design-not-converging"`:** return to `/roster-spec` (minimal-freeze profile). **If `"review-integrity-failure"`:** re-run the claimed tooling for real, never `/roster-spec` (FR-175).

## When to Go Back

| Condition | Action |
|---|---|
| NO-GO verdict — fixes required | Stop — return to `/roster-implement` with OPEN findings listed |
| Research reveals a design flaw missed in planning | Stop — re-run `/roster-plan` or `/roster-intake` before fixes |
| `code-quality-auditor` returns Critical KB violations | Auto-classify as HIGH finding → NO-GO unless immediately auto-fixable |
| `escalation_needed: true` in Express/Fast mode | Present to human — they decide whether to loop back to `/roster-spec` or accept as-is |
| Convergence gate violation, `cause != "unattested-invocation"` (§5.5) | NO-GO, `type: "design-not-converging"` — never silently keep a GO |
| Convergence gate violation, `cause == "unattested-invocation"` (§5.5) | NO-GO, `type: "review-integrity-failure"` — re-run the claimed tooling for real; never `/roster-spec`/streak override |
| Gate exit 3 (`process-incomplete`) | Repair per `violations[].detail` (§5.5), re-gate (max 2 attempts) — never route; surface to human if still failing |
| `no_go_reason.cause == "novel-finding-streak"` and human exercises the override | Route to `/roster-implement` for one more round instead of `/roster-spec`; record `streak_override` and reset this round's `strike` to `false` |

## What Next

**Primary path (GO, Express mode):** `/roster-ship` — Express skips QA
**Primary path (GO, Fast/Full mode):** `/roster-qa`
**Primary path (NO-GO):** `/roster-implement` — pass `briefs/<task>-review.json` as context
**Alternatives:**
- `/roster-audit` — if broader code quality concerns were flagged beyond this task

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.

## Friction Log

Append one entry per run. Canonical template and key set: `skills/shared/preamble-friction.md` (schema: `schema/skill-schema.md`). Set `"skill": "roster-review"`.

## Rules

- Every claim must cite file and line — never "probably"
- "Looks good" is not a finding — omit it
- A caught error is not automatically safe — check blast radius: does it abort a whole request/transaction/batch? If so, flag as correctness/security
- One grouped AskUserQuestion — never multiple separate questions
- Verify quality gates after each auto-fix
- Specialists must produce JSON findings — reject free-form text
- Do not auto-fix visible behavior changes even if under the line threshold
- Never write `briefs/<task>-review.json` before the convergence gate (§5.5) has run and its outcome is merged — gate-before-write is not optional, even on a GO round
- Never mark a HIGH+ finding RESOLVED across a loop-back round without a linked `check`, unless it is ACCEPTED or was raised and resolved within the same round
- The ACCEPT prompt for a HIGH+ finding must state the waiver is permanent — never phrase it as temporary
- Never conflate `round` (physical, two-event lifecycle — resets only at the next cycle's start, INV-3) with `no_go_round` (qualifying-only backstop, reset-on-GO) — they are separate counters with separate reset rules
- Never let the gate's own `process-incomplete` cause escape to routing — it is always repaired pre-persist (max 2 attempts) or surfaced to the human directly, never treated as design-not-converging
- Never persist a draft verdict when the gate's report is missing `config.strikes` or `trace` — treat it as a stale gate script and surface it, never silently proceed
- Never route `review-integrity-failure` to `/roster-spec` or the streak override (FR-175)
- Never append a trace line for an invocation that didn't occur — only running the missed tool repairs `missing-trace` (FR-177/C-3)
