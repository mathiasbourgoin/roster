---
name: skill-hooks
type: spec
status: live
feature: Skill-Level Hook System with Declarative DSL
brief: briefs/skill-hooks-intake.md
date: 2026-05-25
version: 1.1.0
---

# Spec — Skill-Level Hook System

## User Stories

### US-1: Simple Guard Hook (Priority: P0)

As a roster user, I want to attach a pre-hook to any skill that runs shell checks and aborts if they fail, so that I can enforce preconditions before a skill executes.

**Why this priority:** The guard pattern is the foundational use case — all more complex hook behaviors build on it. Without it the feature has no minimal viable value.

**Independent Test:** Create `.harness/hooks/skills/roster-spec/pre.md` with a `run:` step containing `exit 1`. Trigger roster-spec — verify the skill never begins its Steps (no brief artifact is written).

#### GWT Scenarios

**Scenario 1A — Guard aborts on non-zero exit:**
- **Given** `.harness/hooks/skills/roster-spec/pre.md` exists with `run: "exit 1"` and `on_error: stop`
- **When** roster-run dispatches roster-spec
- **Then** the LLM executes the Bash tool with `exit 1`, reads exit code 1, and halts before the skill's Steps begin; no spec artifact is written

**Scenario 1B — Guard passes and skill runs normally:**
- **Given** `.harness/hooks/skills/roster-spec/pre.md` with `run: "[ -f briefs/{{task}}-intake.md ]"` and `on_error: stop`
- **When** the brief file exists
- **Then** the Bash tool exits 0; the hook passes; roster-spec proceeds normally

**Scenario 1C — No hook file, skill runs unchanged:**
- **Given** no pre-hook exists for roster-plan
- **When** roster-run dispatches roster-plan
- **Then** no hook execution occurs; behavior is identical to today

---

### US-2: Agentic Hook Step (Priority: P0)

As a roster user, I want hook steps to invoke named roster skills/agents with a prompt, so that hooks can perform agentic validation or enrichment before or after a skill runs.

**Why this priority:** Without `prompt:` + `agent:`, hooks are bash-only — no better than the existing unused `pre_pr_checks` tunable. Agentic steps are the differentiating capability.

**Independent Test:** Create a pre-hook with `prompt: "Verify the brief is complete"` + `agent: roster-intake`. Trigger the parent skill — verify the agent step executes and the skill gates on the `ABORT:` sentinel.

#### GWT Scenarios

**Scenario 2A — Agentic step gates on ABORT sentinel:**
- **Given** a pre-hook step `prompt: "Check brief completeness" agent: roster-intake on_error: stop`
- **When** the invoked agent emits `ABORT: brief missing Scope section` in its output
- **Then** the hook interprets ABORT: as failure, applies `on_error: stop`, and the parent skill does not run

**Scenario 2B — Agentic step passes cleanly:**
- **Given** the same pre-hook step
- **When** the invoked agent completes without emitting `ABORT:`
- **Then** hook execution continues to the next step; the parent skill runs

**Scenario 2C — `agent:` resolves both skills and agents:**
- **Given** `agent: reviewer` (an agent) and `agent: roster-intake` (a skill)
- **When** the linter validates the hook file
- **Then** both resolve successfully against `.harness/agents/` and `.harness/skills/`

---

### US-3: Conditional and Pipeline Jump (Priority: P0)

As a roster user, I want hook steps to branch on a condition and jump to any roster pipeline step, so that hooks can implement routing logic currently only expressible as prose in "When to Go Back" tables — making it machine-readable and lintable.

**Why this priority:** `test:` + `goto:` together make hooks a machine-readable pipeline controller. The YAML formalism adds tooling value (lintable, health-analysable routing contracts) even when the executor is an LLM.

**Independent Test:** Create a pre-hook with `test: "grep -q 'BOUNCED' briefs/{{task}}-spec.md"` + `on_true: goto: roster-intake`. Trigger parent skill with a bounced spec — verify roster-intake runs next (its artifact is created) and the original skill does not run.

#### GWT Scenarios

**Scenario 3A — Shell test branches to goto:**
- **Given** pre-hook `test: "grep -q 'BOUNCED' briefs/{{task}}-spec.md" on_true: goto: roster-intake on_false: continue`
- **When** the brief contains `BOUNCED`
- **Then** the Bash tool evaluates the test (exit 0 = true), the hook emits a routing directive to roster-run pointing to roster-intake

**Scenario 3B — `goto:` in post-hook, both forward and backward:**
- **Given** a post-hook with `goto: roster-implement` (backward) or `goto: roster-ship` (forward skip)
- **When** the hook executes after the parent skill
- **Then** roster-run receives the goto directive and dispatches the named skill next; intervening pipeline steps are skipped

**Scenario 3C — `label:` + intra-hook `goto:` creates a retry loop:**
- **Given** a hook with `label: top`, subsequent steps, and `goto: top` in an `on_error:` branch
- **When** a step fails
- **Then** execution restarts from `label: top` within the same hook run

---

### US-4: Feedback Loop Hook (Priority: P1)

As a roster user, I want to declare a `loop:` construct in a hook with optional `until:` and nested steps, so that I can implement reinforcement and research loops as reusable, composable hook files.

**Why this priority:** High value for quality reinforcement patterns; depends on US-1/2/3 being solid. Loops with shell `until:` are deterministic; loops with agent `until:` are probabilistic by design.

**Independent Test:** Create a post-implement hook with `loop: until: "npm test 2>&1 | grep -q 'passing'"` containing a `prompt:+agent:` step. Run with failing tests — verify the loop executes multiple times and stops when tests pass.

#### GWT Scenarios

**Scenario 4A — Shell `until:` terminates when condition exits 0:**
- **Given** `loop: until: "npm test 2>&1 | grep -q '0 failing'" steps: [- prompt: "Fix tests" agent: roster-implement]`
- **When** tests are failing
- **Then** the LLM calls Bash tool with the until condition, sees non-zero, runs the loop body; repeats until the condition exits 0

**Scenario 4B — Agent `until:` is explicitly probabilistic:**
- **Given** `loop: until: prompt: "Is research coverage sufficient?" agent: roster-research expect: "TRUE"`
- **When** the loop runs
- **Then** the agent is invoked; its output is evaluated for `TRUE`; the loop terminates when TRUE is returned; the spec explicitly does not guarantee determinism for agent-based until conditions

**Scenario 4C — `break_if:` and `continue_if:` control mid-loop flow:**
- **Given** a loop body containing `break_if: "{{result}} == 'done'"` and `continue_if: "{{result}} == 'skip'"`
- **When** a `capture:` step sets `result`
- **Then** the LLM interprets the condition and breaks or continues accordingly

**Scenario 4D — Hooks are non-reentrant (cycle guard):**
- **Given** a post-hook for roster-implement that invokes roster-implement
- **When** the inner roster-implement run completes
- **Then** its post-hook is NOT triggered (hooks do not fire for skill invocations initiated from within a hook — depth > 1 is excluded)

---

### US-5: Linter Validates Hook Files (Priority: P0)

As a roster contributor, I want `npm run check:hooks` to validate hook file structure and catch schema errors before they silently misbehave at runtime.

**Why this priority:** Without a linter, the DSL has no quality gate. Typos in step keys cause silent misbehavior in an LLM-interpreted system, not parse errors.

**Independent Test:** Malformed hook (missing `agent:` on a `prompt:` step) → `npm run check:hooks` exits non-zero with a clear, actionable error message.

#### GWT Scenarios

**Scenario 5A — Valid hook passes linting:**
- **Given** a well-formed hook file with correct frontmatter and valid steps block
- **When** `npm run check:hooks` runs
- **Then** exit 0, no output

**Scenario 5B — Missing required frontmatter field fails:**
- **Given** hook file missing `skill:` field in frontmatter
- **When** linter runs
- **Then** exit non-zero: `hooks/skills/roster-spec/pre.md: missing required field 'skill'`

**Scenario 5C — Unknown step key fails:**
- **Given** hook step with unrecognized key `execute:` instead of `run:`
- **When** linter runs
- **Then** exit non-zero: `unknown step key 'execute:' at step 2`

**Scenario 5D — `agent:` reference to non-existent entity fails:**
- **Given** `agent: non-existent-skill` in a `prompt:` step
- **When** linter runs
- **Then** exit non-zero: `agent 'non-existent-skill' not found in .harness/agents/ or .harness/skills/`

**Scenario 5E — Loop without shell-resolvable `until:` generates warning (not error):**
- **Given** `loop:` with no `until:` or an agent-based `until:`
- **When** linter runs
- **Then** exit 0 (warning printed to stderr): `warning: loop at step 3 has no deterministic termination condition`

**Scenario 5F — `npm test` includes hook check:**
- **Given** `check:hooks` is added to the `test` npm script
- **When** `npm test` runs
- **Then** hook validation runs as part of the standard quality gate chain

---

### US-6: Health Analysis Proposes and Evaluates Hooks (Priority: P1)

As a roster maintainer, I want `roster-skill-health` to surface `[HOOK]` proposals from friction patterns and detect hook↔skill migration opportunities, so that the system self-optimises over time.

> **Amendment (2026-07-02, execution-model alignment):** the `outcome` field enum is the
> hook runner's real state machine — `pass | warn | abort | pending` (`pending` = hook
> contains LLM-deferred steps). `skip` is **never logged** (nothing executed; logging
> re-entrant/absent-hook skips would double-count). The originally specced `loop-N` form
> and a non-null `loop_iterations` are **reserved** for future native loop execution —
> loops are LLM-deferred in v1, so `loop_iterations` is `null` today. The duration field
> is `duration_ms` (real wall-clock time measured by `scripts/run-hook.ts`, the single
> writer of these records).

**Why this priority:** Health integration closes the feedback loop. Without it, hooks are installed and forgotten — friction from hooks is invisible.

**Independent Test:** Write 3+ friction entries showing roster-implement failing on missing brief → roster-skill-health run proposes a `[HOOK]` pre-hook for roster-implement.

#### GWT Scenarios

**Scenario 6A — Hook friction logged and clustered:**
- **Given** 3 hook runs that aborted with `"brief not found"`
- **When** roster-skill-health reads friction.jsonl
- **Then** entries with `"hook": "pre"` and `"outcome": "abort"` are clustered and produce a `[HOOK]` proposal

**Scenario 6B — Hook→skill absorption signal:**
- **Given** a pre-hook for roster-spec that has run 10 times with 0 aborts and 0 warnings
- **When** health analysis runs
- **Then** a migration signal is emitted: `[ADAPT] roster-spec/pre.md has 100% pass rate over 10 runs — consider absorbing into roster-spec Steps as a native pre-flight check`

**Scenario 6C — Skill→hook extraction signal:**
- **Given** the same pre-flight bash pattern (`[ -f briefs/{{task}}-intake.md ]`) appearing in 3+ skill Steps sections
- **When** health analysis runs
- **Then** a `[HOOK]` extraction proposal: `Pattern detected in 3 skills — extract to .harness/hooks/shared/validate-brief.md`

---

### US-7: Tutorial Ships With the Feature (Priority: P1)

As a new roster user, I want `docs/hooks.md` to explain the hook format, all step types, error behaviors, loops, variables, parallel execution, and include worked examples, so that I can write my first hook without reading source code.

**Why this priority:** A DSL without documentation is unusable. Tutorial is a first-class deliverable.

**Independent Test:** `docs/hooks.md` exists; covers all 8 essential DSL feature categories; contains ≥3 complete worked examples (guard hook, reinforcement loop, conditional pipeline jump).

---

## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | US-1 | `run:` execution in an LLM context — who actually runs the shell command? | **Resolved (user):** LLM calls Bash tool with the command string, reads exit code, applies `on_error:` behavior. LLM-directed execution, not a separate runner. |
| C-2 | US-1 | "Abort" is a behavioral convention, not an enforced primitive | **Accepted risk:** abort semantics depend on LLM following hook instructions. Spec documents this as a known limitation. Linter and clear hook format maximize reliability. |
| C-3 | US-1 | Hook discovery has no story, schema entry, or implementation path | **Resolved (user):** Filesystem auto-discovery — roster-run checks `.harness/hooks/skills/<skill-name>/pre.md` and `post.md` before every dispatch. Zero config required. |
| C-4 | US-1 | Namespace collision between tool-level and skill-level hooks | **Resolved:** Two distinct systems: `hooks/safety/`, `hooks/quality/` (tool-level, shell-only) vs `hooks/skills/<name>/` (skill-level, full DSL). Different schema, different directory, different frontmatter. |
| C-5 | US-2 | "Gates the skill" cannot be enforced — no runtime barrier between hook and skill | **Accepted risk:** Gate semantics are LLM-behavioral. `ABORT:` sentinel + `on_error: stop` is the convention. Documented as best-effort guarantee. |
| C-6 | US-2 | `agent:` conflates skills and agents | **Resolved:** `agent:` resolves any named harness entity — agents (`.harness/agents/`) or skills (`.harness/skills/`). Linter checks both paths. |
| C-7 | US-2 | No output contract between hook agent and hook executor | **Resolved:** Default output contract: success = no `ABORT:` in output; failure = agent emits `ABORT: <reason>` or step exits non-zero. |
| C-8 | US-3 | `goto:` in LLM context is prose with extra syntax — same as existing "When to Go Back" tables | **Resolved:** `goto:` adds machine-readable routing contracts — lintable, health-analysable, extractable by tooling. Value is in tooling, not execution determinism. |
| C-9 | US-3 | "Verify pipeline jumps" is not fully automatable | **Resolved:** Observable via artifact presence — verify goto-target skill artifact exists AND original skill artifact does not. |
| C-10 | US-3 | LLM cannot reliably implement `goto:` to a label (no instruction pointer) | **Accepted risk:** Known limitation. Short hooks (< 10 steps) are reliable; complex intra-hook goto chains in long hooks may drift. Documented in tutorial. |
| C-11 | US-4 | Agent-based `until:` is probabilistic — not a real termination condition | **Resolved:** Shell `until:` is deterministic (Bash exit code). Agent `until:` is explicitly probabilistic by design — spec documents this distinction. |
| C-12 | US-4 | No loop bounds specified | **Resolved (confirmed):** Infinite loops are explicitly allowed. Linter warns on loops without shell-resolvable `until:`. |
| C-13 | US-4 | Post-implement hook trigger — discovery mechanism not defined | **Resolved:** Same auto-discovery as C-3 — roster-run checks `post.md` after each skill dispatch. |
| C-14 | US-4 | Hook recursion — hooks invoking skills that have hooks | **Resolved:** Hooks are non-reentrant at depth > 1. Hook-initiated skill invocations do not trigger further hooks. |
| C-15 | US-5 | Linter validates syntax not semantics — most dangerous failures are invisible | **Accepted:** Spec explicitly documents linter scope: structural validation only. Semantic errors (unreachable goto, non-terminating loops) are runtime risks, not linter scope. |
| C-16 | US-5 | Schema doesn't exist yet — what does linter validate against? | **Resolved:** Schema is written as part of this feature (extension to `schema/hook-schema.md`). Linter validates against the new schema. |
| C-17 | US-5 | check-skill-structure.ts is not a direct template — rules are categorically different | **Resolved:** "Template" means structural checker pattern (frontmatter parsing + fenced block extraction), not identical rules. New rules written from scratch. |
| C-18 | US-6 | Hooks cannot generate friction entries today | **Resolved:** Hooks log to `friction.jsonl` with additional fields: `hook` (pre/post), `outcome` (pass/warn/abort/pending — see US-6 amendment 2026-07-02; loop-N reserved), `duration_ms`, `loop_iterations`. Schema extended. |
| C-19 | US-6 | Migration signals undefined | **Resolved:** hook→skill: 100% pass rate over N runs; skill→hook: identical step prose in 3+ skills. Formal criteria in health skill update. |
| C-20 | US-6 | [HOOK] threshold hardcoded in story, ignores existing tunable | **Resolved:** Uses existing `min_entries_for_signal` tunable. No new tunable. |
| C-21 | US-7 | Error behaviors not yet specified | **Resolved:** Spec (this document) defines error behaviors. Tutorial documents what spec specifies. |
| C-22 | US-7 | `capture:` + `{{var}}` misrepresented as variables | **Resolved:** Tutorial documents these as LLM prompt conventions, not programmatic bindings. Reliability caveats included. |
| C-23 | US-7 | Tutorial depends on all stories being finalized | **Resolved:** Tutorial is the last deliverable in the implementation plan. |
| C-24 | ALL | DSL adds formalism without adding determinism | **User decision:** Full DSL in v1. Known risk accepted. Mitigation: short hooks, shell-based conditions preferred, tutorial documents reliability caveats. |
| C-25 | US-3/4 | `goto:`, `label:`, `loop:`, `break_if:`, `continue_if:` require instruction pointer the LLM lacks | **Accepted risk (user):** LLM simulates these via sequential reading. Reliability degrades with hook length. Short hooks (< 10 steps) are the design target. |
| C-26 | ALL | `capture:` + `{{var}}` is prompt engineering rebranded | **Accepted risk (user):** Same risk as all LLM-interpreted conventions. Documented as such. |
| C-27 | US-4 | `parallel:` duplicates existing prose pattern | **Resolved:** `parallel:` is a structuring convention for prose-parallel spawning — same model as roster-research. Schema key aids tooling. |
| C-28 | ALL | `include:` requires file-loading infrastructure that doesn't exist | **Resolved:** `include:` = LLM uses Read tool to fetch and inline the fragment before processing steps. LLM must have Read in allowed_tools. Linter validates include paths exist. |
| C-29 | US-1 | Step-level `timeout:` is semantically empty — LLM cannot interrupt itself | **Accepted risk:** `timeout:` is advisory — the LLM is expected to respect it by aborting long-running Bash calls. No enforcement mechanism. Documented as best-effort. |
| C-30 | ALL | No demonstrated demand — pre_pr_checks is unused | **User decision:** Full DSL shipped as exploratory infrastructure. Health analysis will surface adoption signals over time. |
| C-31 | US-1 | Contradiction: "no separate process" + `run: exit 1` must abort | **Resolved (user):** LLM calls Bash tool (LLM-directed, not a separate runner). This resolves the contradiction. |
| C-32 | ALL | Hook discovery is the load-bearing mechanism with no spec | **Resolved (user):** Auto-discovery via `.harness/hooks/skills/<skill-name>/pre.md` and `post.md`. roster-run checks before dispatch. Zero config. |

---

## Acceptance Criteria

- **AC-1** [US-1, C-1, C-31]: A `run:` step causes the LLM to invoke the Bash tool with the command string and read the exit code → behavior is LLM-directed shell execution
- **AC-2** [US-1 happy path]: A `run:` step exiting 0 with `on_error: stop` → hook continues to next step
- **AC-3** [US-1, C-3, C-32]: roster-run checks `.harness/hooks/skills/<skill-name>/pre.md` before dispatch → auto-discovered, zero config required
- **AC-4** [US-2, C-6]: `agent:` field resolves named harness entities from `.harness/agents/` AND `.harness/skills/` → both agents and skills are valid targets
- **AC-5** [US-2, C-7]: `ABORT: <reason>` in agent output + `on_error: stop` → parent skill does not run
- **AC-6** [US-3, C-8]: Hook file with `goto: roster-intake` → linter validates target is a known pipeline skill; health analysis can extract routing intent
- **AC-7** [US-3, C-9]: `goto:` in pre-hook → roster-intake artifact created; original skill artifact absent
- **AC-8** [US-4, C-11]: Shell `until: "bash_expr"` → LLM calls Bash tool with expr, reads exit code, terminates loop when exit 0
- **AC-9** [US-4, C-14]: Hook-initiated skill invocations do not trigger further hooks → non-reentrant at depth > 1
- **AC-10** [US-5 happy path]: Valid hook file → `npm run check:hooks` exits 0
- **AC-11** [US-5, C-16]: Missing required frontmatter field (`name`, `event`, `skill`) → `check:hooks` exits non-zero with field name in message
- **AC-12** [US-5, C-15]: Unknown step key → `check:hooks` exits non-zero with key name and step number
- **AC-13** [US-5]: `agent:` referencing non-existent entity → `check:hooks` exits non-zero
- **AC-14** [US-5]: `loop:` without shell-resolvable `until:` → `check:hooks` exits 0 with warning on stderr
- **AC-15** [US-5]: `npm test` includes `check:hooks` → hook validation is a standard quality gate
- **AC-16** [US-6, C-18]: Hook runs append to `friction.jsonl` with `hook`, `outcome`, `duration_ms`, `loop_iterations` fields
- **AC-17** [US-6, C-19]: 3+ friction entries with `hook: pre` + `outcome: abort` → health proposes `[HOOK]` pre-validation for the affected skill
- **AC-18** [US-7]: `docs/hooks.md` exists, covers all 8 DSL feature categories, contains ≥3 worked examples

---

## Edge Cases

- **EC-1**: Hook file exists but is empty or has no `steps:` block → linter error; roster-run skips hook and logs warning
- **EC-2**: `include:` references a non-existent fragment → linter error; runtime: LLM logs `INCLUDE_NOT_FOUND` and continues (on_error: warn default for include failures)
- **EC-3**: `goto:` target is the current skill (self-loop) → linter warning; runtime allowed (creates a loop)
- **EC-4**: `goto:` target is not a known pipeline skill name → linter error: `unknown goto target '<name>'`
- **EC-5**: Both `pre.md` and `post.md` exist for the same skill → both execute; pre before Steps, post after Steps
- **EC-6**: Pre-hook succeeds but skill itself fails → post-hook still fires (post-hooks are not gated on skill success unless `on_skill_error: skip` is declared)
- **EC-7**: Hook file present in `.harness/hooks/skills/` but skill is not installed in the harness → linter warning; no runtime effect
- **EC-8**: `parallel:` steps with `on_error: first-wins` — one step fails → remaining parallel steps continue to completion, then hook aborts
- **EC-9**: `capture:` variable name collides with built-in (`task`, `skill`, `loop.iteration`) → linter error: reserved variable name
- **EC-10**: `timeout:` on a `prompt:+agent:` step — LLM cannot enforce timing; linter accepts, runtime is best-effort

---

## Runnable Checks

- **CHECK-1** [AC-3]: `ls .harness/hooks/skills/roster-spec/pre.md` → expected: exit 0 (file exists after creating a hook)
- **CHECK-2** [AC-10]: Create valid hook file → `npm run check:hooks` → expected: exit 0
- **CHECK-3** [AC-11]: Create hook missing `skill:` field → `npm run check:hooks 2>&1 | grep "missing required field 'skill'"` → expected: exit non-zero, grep matches
- **CHECK-4** [AC-12]: Create hook with `execute:` step key → `npm run check:hooks 2>&1 | grep "unknown step key"` → expected: exit non-zero, grep matches
- **CHECK-5** [AC-13]: Create hook with `agent: does-not-exist` → `npm run check:hooks 2>&1 | grep "not found"` → expected: exit non-zero, grep matches
- **CHECK-6** [AC-14]: Create hook with `loop:` and no `until:` → `npm run check:hooks 2>&1 | grep "warning"` → expected: exit 0, warning on stderr
- **CHECK-7** [AC-15]: `npm test 2>&1 | grep "check-hook-structure"` → expected: line present (hook check runs in test suite)
- **CHECK-8** [AC-16]: Run hook that aborts → `tail -1 skills-meta/friction.jsonl | python3 -c "import sys,json; e=json.load(sys.stdin); assert 'hook' in e and 'outcome' in e"` → expected: exit 0
- **CHECK-9** [AC-18]: `ls docs/hooks.md` → expected: exit 0; `grep -c "## " docs/hooks.md` → expected: ≥8 sections
- **CHECK-10** [AC-6]: `npm run check:hooks` on hook with `agent: roster-intake` (a skill) → expected: exit 0 (resolves from `.harness/skills/`)

---

## Entities

- `SkillHook`: A `.md` file at `.harness/hooks/skills/<skill-name>/{pre,post}.md` containing YAML frontmatter + a fenced `steps:` YAML block; interpreted by the LLM executor before (pre) or after (post) a named roster skill's Steps.
- `HookStep`: One entry in the `steps:` YAML sequence; typed by its primary key: `run:` (shell), `prompt:`+`agent:` (agentic), `test:` (conditional), `loop:` (iteration), `label:` (jump target), `parallel:` (concurrent), `log:` (observability), `include:` (fragment), `output:` (structured result).
- `HookRunner`: The prose instructions in `roster-run` that discover and execute `SkillHook` files before/after skill dispatch — not a separate process; implemented as LLM-interpreted steps in the orchestrator skill.
- `AbortSentinel`: The string `ABORT: <reason>` emitted by an agent step to signal hook failure to the HookRunner; the LLM executor interprets this as a non-zero exit equivalent for `prompt:+agent:` steps.
- `HookFrictionEntry`: A JSONL entry in `skills-meta/friction.jsonl` with additional fields `hook` (pre/post), `outcome` (pass/warn/abort/pending — see US-6 amendment 2026-07-02; loop-N reserved, skip never logged), `duration_ms`, `loop_iterations` (null in v1) — extends the existing friction schema.
- `GotoDirective`: A routing intent expressed as `goto: <skill-name>` in a hook step; machine-readable by linter and health analysis; interpreted by HookRunner as an instruction to dispatch the named skill next.
- `IncludeFragment`: A shared hook step sequence stored in `.harness/hooks/shared/<name>.md`; referenced via `include:` steps; loaded by the LLM using the Read tool before processing the parent hook's steps.

---

## Portability Amendment (2026-07-13)

This amendment supersedes the original prose-only `HookRunner` assumptions above.
Shell-resolvable hook steps are now enforced by a Node runner; LLM-only steps remain
explicitly pending for the orchestrating agent.

- **INV-P1:** Installed workflow and skill instructions MUST invoke
  `.harness/bin/run-hook.js`, never a source-checkout-only `dist/` path.
- **INV-P2:** The installed runner MUST be self-contained and executable with the
  target project's Node runtime when that project has no roster `node_modules`.
- **INV-P3:** `sync-harness.sh` MUST install the runner whenever skill hooks exist and
  `--check` MUST reject a missing or stale runner.
- **INV-P4:** The source runner and bundled runner MUST be deterministically
  byte-equivalent to a fresh build (`npm run check:hook-runtime`).

**Acceptance scenario P1 — installed consumer:** Given a freshly bootstrapped target
without `node_modules`, when a `roster-spec` pre-hook is added and the harness is
synchronized, then `.harness/bin/run-hook.js` exists, accepts an intake containing
`**Status: VALIDATED**`, and rejects the legacy `**Status:** VALIDATED` spelling.

**Runnable check P1:** `npm run check:init-harness` exercises that scenario in a
temporary full-profile consumer and removes the consumer afterward.
