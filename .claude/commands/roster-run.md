---
name: roster-run
description: Classifies an incoming task and routes it to the right pipeline skill.
when_to_use: "Use for any task that doesn't already have an obvious phase. Trigger: '/roster-run', 'work on X'."
version: 1.10.2
---

# Roster Run

You are the entry point of the roster pipeline. Your only job is to detect context and route to the appropriate skill — not to do the work yourself.

## Three modes — pick before anything else

**Read the task first. Classify it. Then route.**

| Mode | When | Pipeline |
|---|---|---|
| **Express** | No spec/KB impact — typo, rename, formatting, config tweak, doc fix, pure refactor with no behaviour change | implement → review → ship |
| **Fast** | Quick task with potential spec/KB impact — bug fix, small behaviour change, adding a missing case, performance fix | implement → review → qa → (update KB/specs/friction log) → ship |
| **Full** | New capability, API change, design decisions, multi-file refactor with trade-offs, anything the user asks to spec first | question → research → intake → spec → plan → implement → review → qa → ship |

**When in doubt between Express and Fast, pick Fast.** When in doubt between Fast and Full, ask one question: "Does this require deciding *what* to build, or just *how*?" — if only *how*, stay Fast.

> Express and Fast are not shortcuts on quality — review is always mandatory. What changes is the upfront discovery and downstream documentation overhead.

### Express signals (all must apply)

- No new behaviour — same inputs produce same outputs after the change
- No spec, KB, or friction log update needed
- Change is self-evident from the task description alone
- Dependency bumps → Fast minimum (they may introduce behaviour changes, break tests, or require KB updates)

### Fast signals (any one is enough)

- Fix to existing behaviour (bug, edge case, missing guard)
- Small addition that doesn't change the overall design
- User says "quickly", "fast", "small", "just fix"
- Task ≤ 20 words and unambiguous but has some spec/KB impact

### Full signals (any one is enough)

- New capability that doesn't exist yet
- API or interface change affecting callers
- Multiple design trade-offs to resolve
- User says "feature", "spec", "design", "plan", "implement from scratch", or asks a question about *what* to build

## Hook Execution

Before routing, check for skill hooks: using the target skill's `name:` frontmatter field as the
lookup key (not the routing slug), look for `.harness/hooks/skills/<name>/pre.md` — prefer the
`.inlined.md` variant if present. After the skill completes, do the same for `post.md`. Execute
shell steps via the hook runner:

```bash
TASK=<task-slug> node .harness/bin/run-hook.js pre <skill-name>   # or: post <skill-name>
# exit 0=pass  1=abort (skip dispatch)  2=warn  3=pending_llm_steps  4=skip (no hook)
```

Export `TASK=<task-slug>` on the same command — pipeline hooks reference `${TASK}` to locate
`briefs/<task>-*` artifacts. Default `on_error` is `stop` for pre-hooks (an abort cancels the
skill dispatch) and `warn` for post-hooks (log and continue). Steps the runner returns in
`pending_llm_steps` (`prompt:`, `loop:`, `parallel:`) are executed by you, the agent, after
reading the runner's JSON output.

**Non-Reentrance Guard.** Before executing any hook, check whether `HOOK_RUNNING` is set in your
current context — if it is, skip hook execution silently for all nested skill invocations. When
executing a hook, set `HOOK_RUNNING: true` for its duration, then clear it.

Full operator reference — hook file format, step-type dispatch table, pre/post execution details,
DSL, linting, exit codes: `docs/hooks.md`.

## Routing

**Step 1 — classify the task (Express / Fast / Full).** Do this before checking briefs/.

**Explicit mode override.** If the task text contains a mode flag — `--express`, `--fast`, or
`--full` — or an explicit instruction to force a mode ("do this full", "spec it first"),
honor it verbatim and skip inference. Strip the flag from the task before routing. An explicit
`--full` always wins even on a task that looks trivial; an explicit `--express`/`--fast` is
honored **unless** classification detects a Full signal that would skip a mandatory phase (a
new public API, an unspecced design decision) — in that case, surface the conflict and ask
before downgrading. Otherwise infer the mode from the signals below.

**Step 2 — critical suggestion check.**

**If `--critical` is passed explicitly:** strip the flag, skip the critical suggestion check below, and dispatch directly to `/roster-triage-critical`. The human flag is the only thing that changes routing.

**If `--critical=rocq` or `--critical=quint` is passed explicitly:** skip triage (backend pre-chosen) but **write the minimal triage brief per roster-triage-critical §Flag-preselected backend (invoked from roster-run)** — downstream skills (`roster-spec-formal`, `roster-formal-verify`) hard-require it. Then route directly to the full pipeline, skipping `roster-triage-critical`.

**Trust-boundary heuristic (FR-009).** Run this deterministic keyword check against the task
description for **every** task, before mode is recorded — it feeds a full-mode recommendation, not
an automatic upgrade:

```bash
desc=$(cat <<'EOF'
<task>
EOF
)
printf '%s' "$desc" | grep -qiE "auth|attest|evidence|authority|permission|token|signature|custody|integrity" && echo "TRUST_BOUNDARY_HIT"
```

If it fires and the task would not already route to Full: recommend Full mode to the human before
the mode is recorded (so `/roster-intake` and `/roster-spec` run and the trust boundary is
minimally frozen — see roster-spec's Trigger Check).

**Combined-prompt rule (A-9):** if this heuristic fires **and** the Tier A `--critical` check below
also fires on the same task, present **one single combined prompt** covering both signals — do not
ask twice. The critical route takes precedence (it already implies full mode), so the combined
prompt's options are exactly the Tier A options below; the trust-boundary signal is folded into
the rationale text shown above them.

Run the following deterministic Tier A checks against the task description and target path. These are grep/file-presence checks only — no LLM judgment. If any Tier A check fires AND the task would route to Full or Fast (not Express), emit a suggestion before routing.

**Tier A — deterministic (any one fires the suggestion):**

```bash
# Keyword check on task description
desc=$(cat <<'EOF'
<task>
EOF
)
printf '%s' "$desc" | grep -qiE "crypto|hash|cipher|signature|proof|zk|ntt|msm|field.arithmetic|merkle|attestat|certif|vulnerability|exploit|attack|adversar|malicious|untrusted.input|invariant|correct.by.construction" && echo "KEYWORD_HIT"

# Adjacent formal spec file
[ -f "$(dirname <target>)/<basename>.v" ]   && echo "ADJACENT_V"
[ -f "$(dirname <target>)/<basename>.qnt" ] && echo "ADJACENT_QNT"

# Crypto import scan (if target is a source file)
grep -qE "ring::|sha2::|bls12_381|ark_|secp256k1|ed25519|ff::" <target> 2>/dev/null && echo "CRYPTO_IMPORT"
```

**Tier B — advisory context (shown as rationale if Tier A fires; never changes routing):**
- On the signature/verification/attestation path
- Consensus-critical (wrong = chain split, lost funds)
- Bug here could enable key leakage, forgery, bypass
- Handles raw untrusted external input
- Financial consequence if wrong (staking, slashing)
- Silent failure mode (wrong answer looks like right answer)
- Multiple bug fixes in git history for the same invariant

**If Tier A fires** (and task is not Express, and `--critical` was not already passed):

Present using `AskUserQuestion` (Claude Code), `ask_user` (Copilot), or the equivalent interactive tool for the active runtime:

```
Before routing to [FAST|FULL]: <Tier A signal that fired>.
<Tier B context if any: "Advisory context: [signals]">

This component might warrant --critical formal verification.

Options:
  --critical        (run roster-triage-critical first)
  --full            (standard pipeline, no formal gate) [default]
  --critical=rocq   (skip triage, go direct to Rocq route)
  --critical=quint  (skip triage, go direct to Quint route)

Which? (default: --full)
```

Default is `--full`. The human must explicitly choose `--critical`. **This is a suggestion, not a gate. It never auto-upgrades.**

If the task would route to Express: skip the critical check entirely (formal verification is incompatible with Express-classified changes).

**If `--critical` is chosen:** dispatch to `/roster-triage-critical` before the normal pipeline. The triage skill produces `briefs/<slug>-formal-triage.md`, then the human confirms the backend, then the pipeline routes per roster-triage-critical §Flag-preselected backend (invoked from roster-run) — see its post-choice pipeline route.

**Step 3 — resume from durable state (all modes, before per-mode routing).**
If this task has already run one or more phases, the append-only ledger `briefs/<task>-state.json`
is the authoritative position — read it **here**, before the per-mode routing below, so Express
and Fast tasks resume too (not only Full). Split existence from parse-and-schema validity so a
corrupt or malformed ledger never silently degrades to a stale resume:

```bash
# Canonical ledger-schema gate — IDENTICAL in roster-doctor `status` mode. Keep them in sync.
# Byte-identity mechanically enforced by `scripts/check-pipeline-install.js`.
LEDGER_SCHEMA='
  {express:["implement","review","ship"],
   fast:["implement","review","qa","ship"],
   full:["question","research","intake","spec","plan","implement","review","qa","ship"]} as $seq
  | {intake:["VALIDATED"],spec:["VALIDATED","SKIPPED","BOUNCED"],
     review:["GO","NO-GO"],qa:["GO","NO-GO"],ship:["COMPLETED","BLOCKED"],
     question:["COMPLETED"],research:["COMPLETED"],plan:["COMPLETED"],implement:["COMPLETED","PARTIAL"]} as $vocab
  | .current_phase as $cp | .mode as $m | (.events[-1]) as $last
  | (.task == $t)
    and ($seq[$m] != null)
    and ($cp|type=="string")
    and (.events|type=="array") and ((.events|length)>0)
    and (all(.events[]; . as $e
          | ($e|type)=="object"
          and ($e.phase|type=="string")
          and (($vocab[$e.phase] // []) | index($e.outcome) != null)
          and (($e|has("reason")|not) or ($e.reason|type=="string"))))
    and ($last.phase == $cp)
    and (($seq[$m]|index($cp)) != null)
'
if [ -f briefs/<task>-state.json ]; then
  if jq -e --arg t "<task>" "$LEDGER_SCHEMA" briefs/<task>-state.json >/dev/null 2>&1; then
    jq -r '"phase=\(.current_phase) mode=\(.mode)"' briefs/<task>-state.json
  else
    echo "CORRUPT: briefs/<task>-state.json is invalid JSON or fails the ledger schema"
  fi
else
  echo "no state"
fi
```

The `jq` gate validates the **complete** ledger schema in one predicate: valid JSON; `.task`
equals this task's slug (a copied/misnamed ledger must not authoritatively resume another task);
`.mode ∈ {express,fast,full}`; `.current_phase` is a string **and a member of that mode's
sequence** (an express ledger claiming `spec` is corrupt, not resumable); `.events` is a non-empty
array; the last event's `phase` equals `current_phase`; the last event's `outcome` is legal
for its phase per the preamble vocabulary — **per-phase strict**: `implement` ∈
`COMPLETED|PARTIAL`, `ship` ∈ `COMPLETED|BLOCKED`, and `PARTIAL`/`BLOCKED` are illegal on every
other phase (a `ship`/`NO-GO` or `intake`/`PARTIAL` ledger is corrupt); and the event's optional
`reason` field, when present, is a string. Nothing downstream re-checks membership — the gate is
authoritative.

- **`CORRUPT`** → **stop.** Do not fall back to brief-file detection or classification — the
  authoritative position is untrustworthy. Report it; tell the user to run
  `/roster-doctor status <task>` or repair/delete the ledger. Resuming from stale briefs risks
  re-running or skipping a phase.
- **`no state`** → fresh task (or one predating state tracking). Skip this step; use the Step 1
  classification and route per the per-mode rules below (Full uses the Detection brief-file table).
- **A `phase=… mode=…` line** → **resume.** The recorded `mode` is authoritative — it overrides
  Step 1 classification (the task already committed to a mode):
  - **express:** `implement → review → ship`
  - **fast:** `implement → review → qa → ship`
  - **full:** `question → research → intake → spec → plan → implement → review → qa → ship`

  (Membership of `current_phase` in this sequence is already enforced by the schema gate above —
  a ledger that fails it never reaches here; it was reported `CORRUPT` and stopped.)

  **If the user passed an explicit `--mode` flag on this resume invocation that *differs* from the
  recorded mode**, do not silently mix a new mode with an old ledger — surface the conflict and
  ask (via the interactive question tool) whether to continue under the recorded mode or restart
  the task under the new mode. The ledger's mode wins unless the user explicitly elects to restart.

  Compute the route from `current_phase` **within that mode's sequence**:

  1. **Terminal.** If `current_phase` is the last phase of its mode's sequence (`ship`), route by
     the latest `ship` event's outcome:
     - `ship`/`COMPLETED` → the task is **complete** — report done, do not invent a next phase;
       start a new cycle only if asked.
     - `ship`/`BLOCKED` → **halt.** Print the event's `reason` (or note it is absent) and stop —
       the block is something the human resolves (permissions, remote state, hold); do not retry
       the ship or route elsewhere.
  2. **Outcome-bearing phases are verdict-aware, not positional.** `intake`, `spec`, `review`, and
     `qa` can complete with a non-success outcome, so do not advance on ledger position alone —
     read that phase's verdict artifact and route via the **Verdict routing table** (in the
     Full-mode routing section below), scoped to the recorded mode. **The verdict artifact must
     exist and carry a recognized verdict** (`briefs/<task>-intake.md` status,
     `briefs/<task>-spec.md` status, `briefs/<task>-review.json` `.status`, `briefs/<task>-qa.md`
     status); if it is absent or unreadable, **stop** with `BLOCKED: missing verdict artifact for
     <phase>` rather than guessing a route.
     - `implement` COMPLETED → the positional successor (`review`); `implement` PARTIAL →
       re-route to `/roster-implement` to finish the remaining in-scope work (surface the
       event's `reason` when announcing the route)
  3. **Otherwise** (`question`, `research`, `plan` — always `COMPLETED`) → the positional
     successor in the mode's sequence.

  Then run **Step 4** before re-entering `/roster-implement`. Announce:
  `→ resuming <task> after <current_phase> (<mode> mode)`. roster-run never writes the ledger —
  each phase appends its own event (preamble *Pipeline State*); roster-run only reads it.

**Step 4 — environment readiness pre-flight (before any code/test work).**
The moment you are about to route to a phase that builds, tests, or edits code
(`/roster-implement`, and any Full-mode route that leads there), first confirm the project's
dev environment is actually runnable. Invoke `/roster-doctor preflight` (skip only for
pure-doc Express tasks that touch no code, build, or tests).

- If it returns `READY` → continue routing.
- If it returns `NOT-READY: <reasons>` → **stop routing.** Surface the reasons and the
  doctor's install/configure options to the user. Do not enter `/roster-implement` until the
  environment is ready or the user explicitly accepts proceeding. Discovering a missing test
  runner or linter here is far cheaper than failing at the quality gate mid-implementation.

If **Express** mode: announce and route directly through **implement → review → ship**.

If **Fast** mode: announce and route through **implement → review → qa → ship** in sequence. After QA, update KB/specs and friction log if impacted.

If Full mode: check briefs/ state and use the routing table below.

### Full-mode routing table

| Detected signal | Route to |
|---|---|
| No brief, new feature, vague or multi-file task | `/roster-question` (then research → intake) |
| `briefs/<task>-intake.md` VALIDATED + (`**Type:**` is feature/api-change OR `**Trust boundary:** yes`) + `briefs/<task>-spec.md` absent | `/roster-spec` |
| `briefs/<task>-intake.md` exists and is validated | `/roster-plan` |
| `briefs/<task>-plan.md` exists and is validated | workflow dispatch (if `briefs/<task>-plan.json` present) → `/roster-implement` — see Post-plan workflow dispatch below |
| Implementation complete, branch ready | `/roster-review` |
| A verdict artifact is present (`briefs/<task>-spec.md` status, `briefs/<task>-review.json` `.status`, `briefs/<task>-qa.md` status) | Route via the **Verdict routing table** below |
| Complex bug with unclear root cause, no obvious fix | `/roster-investigate` |
| New project or existing project without harness | `/roster-init` |
| Periodic analysis, friction patterns | `/roster-skill-health` |
| No signal matches | Stop — ask the user: "What are we doing?" before routing |

### Verdict routing table (authoritative — all modes)

One table owns every verdict edge. Fresh Full-mode detection (above) and Step 3 resume both
route through it; on resume, scope rows to the ledger's recorded mode.

**Convergence gate invocation (FR-024, A-1/A-2).** Before applying any `review`-phase row below —
on both the fresh-detection path and the Step 3 resume edge — invoke the mechanical gate in
`--static` mode (structural checks only, no command execution; roster-review already ran full-mode
verification and persisted results at verdict time):

```bash
node scripts/check-review-convergence.js briefs/<task>-review.json --static
```

- Exit 0 → apply the table below normally.
- Exit 1 or 2 → the route-back is **blocked** regardless of the recorded verdict (this closes the
  resume bypass, C-14/AC-14). Treat it as `design-not-converging` for routing purposes (row below)
  in Fast/Full. **In Express/Fast when no `/roster-spec` phase exists for this mode**, do not route
  anywhere — **stop** and instruct the human to restart the task under full mode; make **zero**
  ledger writes and do **not** upgrade the mode automatically (FR-029). This is a distinct,
  binding stop — separate from the informational Mode Escalation Check in roster-review.

| Phase verdict | Mode scope | Route to |
|---|---|---|
| `intake` VALIDATED | all | Next phase in sequence (intake has no other terminal status) |
| `spec` VALIDATED **or** SKIPPED | full | Next phase in sequence (`plan`) |
| `spec` BOUNCED | full | `/roster-intake` — enrich the brief to resolve the bounce reason, then re-run `/roster-spec` |
| `review` GO | express | `/roster-ship` |
| `review` GO | fast, full | `/roster-qa` — unless the critical E0 exception below applies, in which case `/roster-ship` |
| `review` NO-GO with `no_go_reason.type == "spec-ac-failure"` | full only (express/fast have no spec phase — their NO-GO always routes to implement) | `/roster-spec` — spec ACs were not met; revise the spec |
| `review` NO-GO with `no_go_reason.cause == "novel-finding-streak"` **and** a `streak_override` valid for the CURRENT `round` (`{round, by: "human"}`, matching — E-1) | full | `/roster-implement` — one bounded extra round; the gate itself suppresses the streak violation on re-check (§ convergence gate invocation below still passes), so this row is reachable; stale (non-matching-round) overrides fall through to the row below |
| `review` NO-GO with `no_go_reason.type == "design-not-converging"` **or** the convergence gate blocked the route-back | full (express/fast: stop + restart-under-full per above) | `/roster-spec` — the escalation context forces the minimal-freeze profile regardless of Trust boundary/Type (A-10); the un-encodable finding or round cap IS the invariant gap to spec |
| `review` NO-GO (any other reason) | all | `/roster-implement` — pass review.json as context |
| `qa` GO | fast, full | `/roster-ship` |
| `qa` NO-GO | fast, full | `/roster-implement` |

**Known residual (FR-032):** the review-GO → QA-NO-GO → implement loop is not bounded by this
gate — `/roster-qa` is out of scope for the convergence mechanism.

**Exception — critical E0 path (single authoritative statement):** on `review` GO, if
`briefs/<task>-formal-verify.md` exists and its `**Evidence tier:**` line is `E0p`, `E0m`, or
`E0m-abstract`, route directly to `/roster-ship` — formal-verify replaced the QA gate, so `qa`
is not in the E0 sequence.

### Post-plan workflow dispatch (Full mode only)

When the routing table routes to "workflow dispatch → `/roster-implement`", perform these checks in order:

**1. Check for plan.json** (backward-compatibility gate):
```bash
[ -f briefs/<task>-plan.json ] && echo "plan.json: present" || echo "plan.json: absent"
```
If absent: skip workflow dispatch entirely — route directly to `/roster-implement` (pre-feature task or plan.json not yet generated).

**2. Check for existing workflow file**:
```bash
[ -f workflows/<task>.cwr.json ] && echo "workflow: present" || echo "workflow: absent"
```
If absent: invoke `/roster-workflow-build` (presents Gate 1 interactively). On resume with workflow already present: skip workflow-build and proceed to dispatch.

**3. Dispatch**:
```bash
command -v cwr >/dev/null 2>&1 && echo "cwr: available" || echo "cwr: absent"
```
- **CWR available** and `workflows/<task>.cwr.json` present — two sub-paths:
  - **Default** (cabal runtime):
    ```bash
    TASK=<slug> cwr run workflows/<task>.cwr.json
    ```
    Exit 0: proceed to Gate 2 check (below).
    Exit non-zero: report `✗ cwr run exited <N> — pipeline halted. Inspect cwr output above.` and **STOP** (do not route to `/roster-implement`).
  - **Claude Code Workflow tool** (when target runtime is Claude Code's Workflow tool):
    ```bash
    TASK=<slug> cwr to-claude-workflow workflows/<task>.cwr.json
    ```
    Pipe the compiled JavaScript output to the `Workflow` tool for execution. Compilation notes go to stderr. Exit non-zero from `cwr to-claude-workflow`: **STOP** (same as above).
- **CWR absent**: route to `/roster-implement` (existing manual chain, unchanged).

**4. Execution-only cleanup** (before Gate 2):
```bash
if [ -f workflows/<task>.cwr.json.ephemeral ]; then
  rm -f workflows/<task>.cwr.json workflows/<task>.cwr.json.ephemeral
fi
```

**5. Gate 2** (post-CWR execution, skip if manual chain was used):

Skip Gate 2 if:
- `workflows/<task>.cwr.json` is absent (execution-only was cleaned up), OR
- `git diff --quiet HEAD -- workflows/<task>.cwr.json` exits 0 (no changes)

Otherwise present AskUserQuestion:
- **commit (bumps version)**: increment `_roster_version` patch level in the file, then `git add workflows/<task>.cwr.json && git commit`
- **keep local**: no action
- **remove**: `rm workflows/<task>.cwr.json`

### Detection

This is the **fresh-task** path for Full mode (no durable ledger — a resumable task is handled
earlier and authoritatively by **Step 3** when `briefs/<task>-state.json` exists). It is also
the brief-file source of truth that Step 3 reads when routing an outcome-bearing phase
(intake/spec/review/qa) by verdict.

1. Check for the existence of `briefs/` artifacts with explicit bash commands:
   ```bash
   ls briefs/ 2>/dev/null || echo "briefs/ absent"
   # Then for the current task:
   [ -f briefs/<task>-intake.md ] && echo "intake: present" || echo "intake: absent"
   [ -f briefs/<task>-spec.md ]   && echo "spec: present"   || echo "spec: absent"
   grep '\*\*Type:\*\*' briefs/<task>-intake.md | head -1
   [ -f briefs/<task>-plan.md ]   && echo "plan: present"   || echo "plan: absent"
   [ -f briefs/<task>-review.json ] && echo "review: present" || echo "review: absent"
   # If review.json is present, read its status and no_go_reason:
   [ -f briefs/<task>-review.json ] && jq -r '"\(.status) \(.no_go_reason.type // "none")"' briefs/<task>-review.json 2>/dev/null
   [ -f briefs/<task>-qa.md ]     && echo "qa: present"     || echo "qa: absent"
   ```
2. Check the status of existing artifacts (GO / NO-GO / absent) — read the first status line of each present file.
3. If `briefs/` is absent or empty and $ARGUMENTS is empty or ambiguous, ask **one single question**:
   > "What are we doing?" (do not propose a list, let the user describe)

### Announce

Before routing, announce in one line:
> "→ [EXPRESS|FAST|FULL] mode: <route> because <reason in 5 words max>"

## When to Go Back

| Condition | Action |
|---|---|
| No route matches the current project state | Stop — ask the user to describe the situation before routing |
| Routing would skip a mandatory phase | Route to the earliest upstream phase instead |

## What Next

After routing, the destination skill announces its own **What Next** upon completion — follow that chain.

## Rules

- Never do the work of another skill — route only
- Never route to multiple skills in parallel from here
- If no route matches, ask the user before inventing one
