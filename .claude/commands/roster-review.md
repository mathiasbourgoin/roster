---
name: roster-review
description: Performs a fix-first code review with conditional specialists and a GO/NO-GO verdict.
when_to_use: "Use after roster-implement completes, before QA. Trigger: 'review this', 'roster-review'."
version: 1.8.0
domain: pipeline
phase: review
preamble: true
friction_log: true
allowed_tools: [Read, Edit, Write, Bash, Agent, Skill, AskUserQuestion]
human_gate: after
tunables:
  auto_fix_threshold_lines: 20
  always_run_spec_compliance: true
  max_no_go_rounds: 5
artifacts:
  reads:
    - briefs/<task>-impl.md
    - briefs/<task>-reviewer.md
    - briefs/<task>-review.json (prior round, if present — cumulative findings + no_go_round source)
    - git diff (current)
  writes:
    - briefs/<task>-review.json
pipeline_role:
  triggered_by: /roster-implement completed
  receives: briefs/<task>-impl.md + current diff
  produces: briefs/<task>-review.json GO or NO-GO
---


# Roster Preamble

## Principles

### Completeness

Do not defer tests, documentation, or robustness in the name of speed.
"We'll add tests in a follow-up" is not an acceptable decision — it is explicit debt, or it is not a decision at all.

### Search Before Build

Before creating anything, verify what already exists:
1. Local (current repo, harness, KB)
2. Roster (index.json, roster GitHub)
3. Web (if webfetch available)

### Anti-Sycophancy

Do not validate a direction if you have a grounded objection.
Do not say "good idea" before verifying it is a good idea.
If you spot a problem, say so — clearly, factually, without softening.
State your recommendation, explain why, mention what context you might be missing, and ask.

### User Sovereignty

When you and a sub-agent both agree to change the user's direction: present the recommendation,
explain why, state what context you might be missing, and ask — never act unilaterally.

### Escalation

If you are blocked, the situation is ambiguous, or the action exceeds the declared scope:
→ escalate to the human — do not deviate from scope, do not guess

### Asking Questions

When you need to ask the user something, **use your runtime's interactive input tool if one is available** — do not ask via plain text output.

Known runtime tool names:

| Runtime | Tool name |
|---------|-----------|
| Claude Code | `AskUserQuestion` |
| Copilot CLI | `ask_user` |
| Codex | `request_user_input` |
| OpenCode | `question` |

Rules:
- One question at a time — never bundle multiple questions into one message
- Prefer multiple-choice options over open-ended when the answer space is predictable
- If no interactive tool is available, output a clearly marked plain-text question and wait for the user's reply before proceeding


### Pipeline State

If your skill's `phase:` frontmatter field is **non-null** (i.e. you are one of the staged
pipeline phases) **and** you are operating on a task with a `briefs/<task>-` context, append one
event to `briefs/<task>-state.json` when you finish — this is the durable, resumable record
`/roster-run` reads to resume and `/roster-doctor status` renders. Skip entirely if your `phase:`
is `null` (the standalone skills — e.g. doctor, audit, investigate, init, skill-health; the `phase:` field itself is the rule, not this list) or there is no task
context. Create the file if absent; preserve every prior `events` entry:

```json
{
  "task": "<slug>",
  "mode": "express|fast|full",
  "current_phase": "implement",
  "events": [
    { "phase": "implement", "outcome": "COMPLETED", "at": "<ISO-8601 or omit>", "by": "roster-implement" }
  ]
}
```

Rules for writing your event:

- **`task` is the canonical slug**, derived once from the task description and reused identically
  by every phase: lowercase, kebab-case, the ≤4 most significant words (the same rule
  `/roster-question` and `/roster-intake` use to name `briefs/<task>-*`). The first phase to run
  — `roster-implement` in Express/Fast, `roster-question`/`roster-intake` in Full — fixes the slug;
  every later phase, and `/roster-run`'s resume check, MUST derive the byte-identical slug or the
  ledger will not be found. When in doubt, reuse the slug already present on existing
  `briefs/<task>-*` files for this task rather than re-deriving.
- **`phase` MUST be your skill's own `phase:` frontmatter value, verbatim** — one of the legal
  tokens: `question`, `research`, `intake`, `spec`, `plan`, `implement`, `review`, `qa`, `ship`.
  Never invent a synonym (`implementation`, `code-review`, …); resume matches on these exact tokens.
- **`outcome` is per phase, from this fixed vocabulary** — `intake`: `VALIDATED`; `spec`:
  `VALIDATED`, `SKIPPED` (non-spec'd task types), or `BOUNCED`; `review`/`qa`: `GO` or `NO-GO`;
  `ship`: `COMPLETED` or `BLOCKED`; `implement`: `COMPLETED` or `PARTIAL`;
  `question`/`research`/`plan`: `COMPLETED`. Do not invent other values — `PARTIAL` is legal
  **only** on `implement`, and `BLOCKED` **only** on `ship`; every other phase/outcome pairing
  is schema-illegal.
- **Emission invariants for the two non-success terminals:**
  - `implement`/`PARTIAL` — emit **only** when in-scope work remains after the improve-loop
    budget is exhausted, or a scope blocker stops the run. Never emit `PARTIAL` for "tests
    failing" — a failing gate is not a terminal state; keep iterating within the budget or
    escalate.
  - `ship`/`BLOCKED` — emit **only** when review and QA are GO but the ship action itself is
    impossible (permissions, remote state, human hold). A NO-GO gate is not `BLOCKED`.
  - Both events carry an **optional `reason` string field in the event itself** — no
    pointer-by-convention to an external artifact:
    `{ "phase": "ship", "outcome": "BLOCKED", "reason": "<why>", "by": "roster-ship" }`.
  - **Artifact writes happen BEFORE the event append.** Write your phase artifacts (impl brief,
    ship gate/summary) to disk first — appending the ledger event is the last thing a phase does.
- **Resume semantics** (read by `/roster-run` Step 3): a latest event `implement`/`PARTIAL`
  re-routes to `/roster-implement`; a latest event `ship`/`BLOCKED` halts the pipeline and
  surfaces the event's `reason` to the human.
- **Append-only audit trail.** Always push a *new* event — never rewrite or delete a prior one.
  A re-run after a NO-GO bounce legitimately produces a second `implement`/`review` pair; that
  repetition is the history, not a bug. Set `current_phase` to your phase (the latest completed).
- `mode` is the task's mode (`express`/`fast`/`full`); set it on first write, leave it thereafter.
- Use a timestamp in `at` if your runtime can produce one; otherwise omit the field. `by` is your
  skill name (or `human-gate` for a gate decision).
- Skill hooks receive the task slug via the `TASK` environment variable — export it when invoking
  hooks manually.


### Friction Log

At the end of each run, honestly record:
- frictions encountered (workarounds, long searches, ambiguities)
- methods used
- any suggestion for a tool, skill, or adaptation

This is not a performance review. It is cross-run memory.

Canonical entry template (append to `skills-meta/friction.jsonl`; set `"skill"` to your
skill's name — extra documented fields like `event` or `mode` are allowed):

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "<skill-name>",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

Schema: `schema/skill-schema.md`.


# Roster Review

You conduct a structured, fix-first review. Mechanical corrections are applied without asking. Ambiguities are grouped into one question. You produce a structured JSON verdict.

**Golden rule:** every claim must cite the file and line. Never "probably" or "likely".

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

Runs **after** auto-fixes, so the gated state is the state that ships.

**Branch on mode first** (from `briefs/<task>-impl.md`): in **Express/Fast**, skip this gate
unconditionally and silently — even if a stale `briefs/<task>-manifest.txt` exists (no manifest
is derived in those modes by design; a leftover file must not produce findings). Only in **Full
mode** continue:

```bash
[ -f "briefs/<task>-manifest.txt" ] && echo "manifest: present" || echo "manifest: absent"
```

- **Manifest present** → run the gate script:
  ```bash
  bash scripts/check-scope-diff.sh "briefs/<task>-manifest.txt"
  ```
  Exit 0 → no violations. Exit 1 → stdout is a JSON array of findings (`severity: HIGH`,
  `category: "scope"`, `line: 0`, fingerprint `<path>:0:scope`) — merge them **verbatim** into
  `findings`. Any OPEN scope finding sets `status: NO-GO` with
  `no_go_reason.type = "out-of-scope-change"`. A human may ACCEPT a scope finding in the grouped
  ambiguity pass (step 5) — an ACCEPTED scope finding unblocks like any other; acceptance is the
  scope escape hatch. Exit 2 (manifest malformed) → treat as absent below.
- **Manifest absent** (Full mode — corroborated by `briefs/<task>-implementer.md` existing) →
  emit one MEDIUM informational finding "scope gate skipped — no manifest"; never NO-GO for this.

Auto-fixes (step 2) must stay within manifest entries when a manifest is present — this gate
runs after them and flags any excursion regardless of author. Known blind spots (documented in
the script): a task edit to a pre-task-dirty file is excluded; a mid-phase third-party file is
attributed to the task and must be human-ACCEPTED.

When spawning the `reviewer` agent (step 3), state in its instructions whether this gate ran —
when it ran, the agent defers scope assessment to it and emits no scope findings of its own.

### 3. Conditional specialists

Spawn specialists based on scope. Each specialist receives:
- The complete diff
- The `briefs/<task>-reviewer.md`
- Their own instructions (path below)
- Whether the deterministic scope gate (§2.5) ran — the `reviewer` agent defers scope assessment to it when it did

**Uncommitted-tree work:** when reviewing work done on uncommitted working-tree files, capture the **pre-task tree state** (`git diff --stat` + `git status` snapshot recorded at task start — e.g. from the intake/impl brief) and pass it to every specialist, so scope-discipline claims are verifiable without session history.

| Specialist | Condition | Path / Invocation |
|---|---|---|
| `spec-compliance` (per-feature) | `specs/<task-slug>.md` exists | Invoke `spec-compliance-auditor` with spec path as `$ARGUMENTS` |
| `spec-compliance` | Always if KB exists (`kb/spec.md` present) | Skill — read `skills/kb/spec-compliance-auditor.md` and invoke via `Skill` tool or spawn as sub-agent with this content |
| `code-quality-auditor` | Always if KB exists (`kb/properties.md` present) | Skill — read `skills/kb/code-quality-auditor.md`; provide diff + `kb/properties.md` + `kb/glossary.md` + reviewer.md |
| `architect` | Medium or large blast radius (>3 files modified or public module) | `.claude/agents/architect.md` |
| TUI pass (via `reviewer`) | TUI scope detected in diff or brief | Spawn the `reviewer` agent with a TUI checklist appended: rendering at 80x24/120x40/220x50, keyboard navigation paths, terminal-capability fallbacks, escape-sequence hygiene. (Deterministic tmux verification happens later in `/roster-qa`.) |
| `reviewer` (agent) | Always | `.claude/agents/reviewer.md` |
| `cross-runtime-reviewer` | **Mandatory** in Fast/Full when a runtime CLI other than the host is on `PATH` (`codex` or `opencode`); skip only by explicit human decision | See **Cross-Runtime Review** below — an independent second-model pass |

### Cross-Runtime Review

When a **different** runtime CLI is available, run an independent adversarial pass. Detection:

```bash
command -v codex >/dev/null 2>&1 && echo "codex available"
command -v opencode >/dev/null 2>&1 && echo "opencode available"
```

If neither is present (or only the host runtime), **skip silently**.

**Mandatory for Fast/Full reviews when a second runtime CLI is on `PATH`.** This pass may be skipped **only by explicit human decision** — never silently. If skipped, record the human decision in the verdict.

**Invocation:** use the wrapper — it closes stdin (bare `codex exec` hangs), sets
`--skip-git-repo-check`, file-captures output (survives output-mangling shell wrappers), and
takes the before/after tree-integrity snapshot automatically (exit 3 = tree mutated):

```bash
bash scripts/xruntime-exec.sh codex "<prompt>" [--write] [--timeout <sec>]
```

Pass `--write` only when the pass must run builds (workspace-write sandbox). Pass the diff and `briefs/<task>-review.json`; instruct it to return **only findings the primary missed**, as JSON in the standard finding schema with `specialist: "<runtime>-xruntime"`. Verification prompts must state claims in **behavioral terms** (observable behavior, not implementation phrasing) — disputes over phrasing are not findings.

**Augment, never rewrite.** Append returned objects to `cross_runtime_findings`. Do **not** edit primary `findings` entries.

**GO authority:** any `cross_runtime_findings` entry that is CRITICAL or HIGH (OPEN) sets `status: NO-GO` with `no_go_reason.type = "cross-runtime-finding"`.

**KB-conditional check:** `[ -d kb ] && [ -f kb/properties.md ] && echo "KB present" || echo "KB absent"`

If KB is present, `code-quality-auditor` findings are merged into the review table. Critical KB violations are auto-classified as HIGH severity.

When findings have `category: "spec"` and severity CRITICAL or HIGH:
- Set `no_go_reason.type = "spec-ac-failure"` in the verdict
- Populate `no_go_reason.failed_acs` from each finding's `acs` array (the
  spec-compliance-auditor's embedded mode supplies it — `AC-N`/`FR-NNN` ids when the
  spec source is a `specs/<task-slug>.md` contract, `S<N>` claim ids when auditing
  against `kb/spec.md`, which has no AC section)

**Expected findings format from each specialist:**

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

### 4. Deduplication

If two specialists report the same finding (same `fingerprint` or same path+line+category):
- Keep the finding with the highest severity
- Note that both specialists converged (confidence signal)

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

This applies to every round of a task, not just loop-backs — the gate runs on **every** verdict
emission, GO included (A-1): the ratchet is enforced most strictly on the round that ends the loop.

**Cumulative findings (FR-010).** Read the prior `briefs/<task>-review.json` if it exists.
`findings` is cumulative across a task's rounds: carry every prior entry forward **verbatim**,
updating only `status` (and the round-tracking fields below) — never re-derive a fingerprint or
drop an entry because a specialist didn't re-report it this round. **Reset `findings` to empty on
a GO verdict** (after the promotion in the GO-verdict step below).

**Per-finding round-tracking fields (FR-011).** Every finding — old and new — carries these seven
fields in addition to the existing schema:

| Field | Type | Meaning |
|---|---|---|
| `first_seen_round` | int | the round this finding first appeared |
| `resolved_round` | int \| null | the round it was marked RESOLVED, if any |
| `check` | string \| null | path to the linked ratchet check (see below) |
| `check_encodable` | bool | default `true`; `false` = implementer proposes no deterministic check is possible |
| `red_verified` | bool \| null | set by the gate's full-mode red/green run |
| `pre_fix_sha` | string \| null | HEAD at the round this finding was first recorded as a NO-GO driver |
| `check_blob` | string \| null | `git hash-object` of the check file at last verification |

**The ratchet rule (FR-012/FR-013).** A HIGH+ finding whose `resolved_round > first_seen_round`
(i.e. it survived at least one loop-back) MUST carry a non-null `check` before it can be marked
RESOLVED. Exempt: findings raised and resolved within the **same** round (never crossed a
loop-back), and findings the human marks `ACCEPTED`. Two findings that reveal the same invariant
MAY share one check.

**Consuming the `## Ratchet` section (FR-017).** The implementer declares each new check in a
`## Ratchet` section of `briefs/<task>-impl.md` (finding reference, check path, red command,
proposed `check_encodable` + reason if false). Read it and populate the corresponding finding's
`check`/`check_encodable` fields from it — this is the only channel; do not infer a check path
from the diff.

**Check-value contract.** The gate always invokes a finding's `check` as `node <path>` (A-6 — the
check file itself is the red/green command). A `check` value MUST therefore be a node-runnable
file path. A spec-level `CHECK-N` id with no corresponding file is recorded in `review.json` (for
traceability) but is **not** red/green-executed by the gate — it is out of scope for mechanical
verification, not a violation; do not expect the gate's `checks[]` report to cover it.

**Permanent-waiver ACCEPT prompt (FR-014).** When the human ACCEPTs a HIGH+ finding in the step 5
grouped ask, the prompt text MUST state that accepting **permanently waives** the invariant — no
check will ever guard it. Do not phrase acceptance as "skip for now".

**Cross-runtime mirroring (FR-015).** When a `cross_runtime_findings` entry is CRITICAL/HIGH and
drives the NO-GO, mirror it into the primary `findings` array (with the same seven fields,
`first_seen_round` = this round) so it enters the ratchet. The original entry in
`cross_runtime_findings` is never edited — augment-only.

**`no_go_round` (FR-021, FR-026).** Read the prior value (0 if absent/first round). Increment it
by exactly 1 when this verdict is NO-GO **and** at least one OPEN HIGH+ finding outside
`category: "scope"` drove it (a scope-only NO-GO does not increment — the scope gate is a separate
mechanism). Reset to 0 on GO. Compare against `tunables.max_no_go_rounds` (default 5) — reaching or
exceeding it is a gate violation (`cause: "round-cap"`), independent of the finding-level checks.

**`pre_fix_sha` recording (FR-033, amended A-3).** At NO-GO verdict emission, for each **new**
HIGH+ finding recorded this round, verify the tree is clean (`git status --porcelain` empty) —
roster-implement commits each round's work before handoff (FR-040). If clean: `pre_fix_sha` =
current `HEAD`. If dirty: `pre_fix_sha` = `null` with reason `"dirty-tree"` — never record a
confidently wrong SHA. When `pre_fix_sha` is `null` (dirty tree or genuinely uncommitted-tree
task), `red_verified` stays `null`; the gate accepts this but flags it in the one-liner (FR-034).

**Gate invocation — fixed order (A-2).** Compose the draft verdict (fields above populated) BEFORE
writing anything to disk. Then invoke the gate:

```bash
node scripts/check-review-convergence.js briefs/<task>-review.json.draft --max-rounds <tunables.max_no_go_rounds> --timeout 120
```

(Write the draft verdict to a `.draft` suffix first so the gate has a file to read without
touching the real artifact yet.) The gate runs full mode here — it executes red/green verification
for any check needing it and reports results as JSON on stdout. Merge the gate's `checks[]` results
(`red_verified`, `check_blob`) back into the corresponding findings, and merge any blocking outcome
into the verdict:

- Gate exit 0 → no change to the verdict's status.
- Gate exit 1 or 2 → **the verdict becomes NO-GO regardless of what step 6 computed**, with
  `no_go_reason.type = "design-not-converging"` and `no_go_reason.cause` taken from the gate's
  violation (`"round-cap"` or `"unencodable-finding"` — the gate's `checks[]`/`violations[]`
  reports which). This applies even to a round that would otherwise be GO (A-1) — vacuous checks,
  RESOLVED-without-check, and blob-weakening findings all invalidate a GO.

Only then write `briefs/<task>-review.json` **once** (rename the draft or write the merged object)
— there is no post-write crash window, and the file is never in a half-written or unverified state.
**Remove the `.draft` file after the merged write** (whether you renamed it or wrote a fresh
object) — no orphan draft artifacts should remain in `briefs/`.

**GO-verdict promotion (FR-042, A-8).** Before resetting `findings` on a GO verdict, promote every
`red_verified: true` check to a permanent home: if `specs/<task-slug>.md` exists, append it as a
new `CHECK-N` entry (with its paired `AC-N` describing the now-permanent invariant); otherwise it
stays in the test suite as an ordinary test (documented residual — post-GO weakening protection
degrades to normal test discipline once the ratchet's round-scoped bookkeeping resets).

### 6. Write the verdict

Produce `briefs/<task>-review.json`:

```json
{
  "task": "<task-slug>",
  "date": "<ISO-8601>",
  "status": "GO|NO-GO",
  "auto_fixes_applied": [
    {
      "path": "file.ml",
      "line": 10,
      "category": "dead-code",
      "description": "Removed unused variable `x`"
    }
  ],
  "findings": [
    {
      "severity": "HIGH",
      "confidence": 4,
      "path": "file.ml",
      "line": 42,
      "category": "correctness",
      "summary": "...",
      "evidence": "...",
      "fix": "...",
      "fingerprint": "file.ml:42:correctness",
      "specialist": "reviewer",
      "status": "OPEN|RESOLVED|ACCEPTED",
      "first_seen_round": 1,
      "resolved_round": null,
      "check": null,
      "check_encodable": true,
      "red_verified": null,
      "pre_fix_sha": null,
      "check_blob": null
    }
  ],
  "cross_runtime_findings": [
    {
      "severity": "HIGH",
      "confidence": 4,
      "path": "file.ml",
      "line": 42,
      "category": "correctness",
      "summary": "...",
      "evidence": "...",
      "fix": "...",
      "fingerprint": "file.ml:42:correctness",
      "specialist": "codex-xruntime",
      "status": "OPEN"
    }
  ],
  "summary": {
    "critical": 0,
    "high": 0,
    "medium": 0,
    "low": 0,
    "auto_fixed": 0
  },
  "no_go_reason": {
    "type": null,
    "cause": null,
    "failed_acs": []
  },
  "no_go_round": 0,
  "mode": "express|fast|full",
  "escalation_needed": false,
  "escalation_reason": null
  // type values: null | "spec-ac-failure" | "code-plan-failure" | "cross-runtime-finding" | "out-of-scope-change" | "design-not-converging"
  // cause values (only set when type == "design-not-converging"): null | "round-cap" | "unencodable-finding"
  // escalation_reason: null | "new-public-api" | "implicit-design-decision" | "spec-update-needed" | "behaviour-change"
  // cross_runtime_findings: appended by the cross-runtime reviewer (augment-only); omit the key entirely if no second runtime ran
}
```

**GO status if:** no CRITICAL or HIGH OPEN finding **in either `findings` or `cross_runtime_findings`**, AND the convergence gate (§5.5) reports no violation.
**NO-GO status if:** at least one CRITICAL or HIGH OPEN finding (primary or cross-runtime) not resolved or explicitly accepted, OR the convergence gate reports a violation. A cross-runtime CRITICAL/HIGH sets `no_go_reason.type = "cross-runtime-finding"`; a gate violation sets `no_go_reason.type = "design-not-converging"` with `cause` per §5.5.

### 7. Human gate

Present a one-line summary: auto-fixes applied, finding counts by severity, GO/NO-GO status,
**`no_go_round` and the checks added this round** (FR-031) — e.g. "round 2/5, 1 new ratcheted
check (`checks/foo.test.js`, red-verified)". If a finding's `pre_fix_sha` is null, flag it
explicitly (uncommitted-tree or dirty-tree residual, FR-034/A-3). If NO-GO, name the HIGH+
findings to resolve. Wait for explicit human confirmation before proceeding.

**Known residual (FR-032):** the review-GO → QA-NO-GO → implement loop is not bounded by the
convergence gate — `/roster-qa` is explicitly out of scope for this mechanism.

## Output Contract

`briefs/<task>-review.json` with GO or NO-GO status and all findings documented.

**If GO:** `/roster-qa` can start. **If NO-GO:** return to `/roster-implement` with OPEN findings. **If `no_go_reason.type == "spec-ac-failure"`:** return to `/roster-spec` — spec ACs were not met. **If `no_go_reason.type == "design-not-converging"`:** return to `/roster-spec` (forces the minimal-freeze profile, A-10) — the round cap was reached or a finding cannot be encoded as a check.

## When to Go Back

| Condition | Action |
|---|---|
| NO-GO verdict — fixes required | Stop — return to `/roster-implement` with OPEN findings listed |
| Research reveals a design flaw missed in planning | Stop — re-run `/roster-plan` or `/roster-intake` before fixes |
| `code-quality-auditor` returns Critical KB violations | Auto-classify as HIGH finding → NO-GO unless immediately auto-fixable |
| `escalation_needed: true` in Express/Fast mode | Present to human — they decide whether to loop back to `/roster-spec` or accept as-is |
| Convergence gate reports a violation (§5.5) | The draft verdict becomes NO-GO with `no_go_reason.type: "design-not-converging"` — never silently keep a GO |

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
