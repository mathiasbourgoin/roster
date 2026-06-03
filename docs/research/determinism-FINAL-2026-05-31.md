# Roster Harness Determinism — FINAL Consolidated Spec (Adversarially Reviewed)

*Consolidated 2026-05-31. This document fuses the anchored proposal set (C1–C47, each with INTERNAL/RESEARCH anchors and a designed status) with the adversarial red-team pass (SOUND / WEAKEN / RECLASSIFY / DROP per proposal + systemic findings). It is self-contained: terms are defined inline; the reader does not need the source documents. Where the adversarial pass changed a verdict, the change and its one-line reason are stated against the proposal.*

---

## 1. Executive Summary

The roster is a multi-agent coding harness — a pipeline of skills (intake → question → research → spec → plan → implement → review → qa → ship) plus standalone auditors. Its load-bearing gates today are overwhelmingly **agent-asserted**: a model reads prose and self-reports "GO", "VALIDATED", "COMPLETED", "RED/GREEN". The program goal is to replace *self-judgment* with a **sound external verifier** wherever one can exist, and to keep judgment only where no sound verifier can.

The adversarial pass did not overturn that direction, but it sharpened three things that change how the proposals must be presented and sequenced:

1. **Enforcement must live in the target project — and today it doesn't.** Roster currently lints only its *own* files; it installs nothing into the projects it is used on. The goal, and the prerequisite workstream **W0**, is for roster to **install and keep updated the project's enforcement layer** — a CI workflow *for that project*, plus agent-runtime hooks (Claude/Codex/…) and git hooks, all consent-gated and capability-detected — so gates run in the project's own pipeline, independent of the authoring agent. Until W0 exists, every "firm gate" is agent-honored prose ("designed" ≠ "enforced"), and W0 is also what supplies the disjoint oracle the rest of the set needs.
2. **Disjointness, not determinism, is the load-bearing property.** A verdict recomputed from an artifact the *same agent authored* is deterministic but **not disjoint** from what the agent optimizes. The biggest flaw in the anchored set is that the "garbage-in" caveat (originally applied only to C9) actually applies to roughly a dozen "firm" gates that recompute from agent-authored inputs (C1/C4, C13, C15, C32, C38, C47, …).
3. **The document's own best idea was applied selectively.** C25 correctly demotes fixed metric thresholds from gates to advisory signals (the threshold-as-defect-oracle is folklore). But the same magic-number pattern was smuggled back into firm/computed gates: C7 count-floors, C19 auto-severity, C33 depth floors, C46 overlap ratio. These are now reconciled with C25 — all treated as advisory.

Concrete reclassifications applied below: **C10** anti-hedging zero-count gate → ADVISORY (a zero-hedge gate manufactures the false confidence the whole program fights, and violates the repo's own anti-sycophancy rule). **C33** research-depth floor → ADVISORY (C25-class magic numbers). **C46** overlap ratio → ADVISORY (already conceded). **C7** count-floor half → ADVISORY (Goodhart; the symmetric-diff/uniqueness half stays firm). **C16** keeps its disjointness core but loses its STRONG label (anchored on uncitable papers). **C1/C4** are narrowed (the oracle is not disjoint from the findings array the agent writes). The proposals resting on durable evidence and disjoint oracles — C5, C8, C11, C12, C17, C20, C21, C23, C24, C25, C29, C31 — survive as firm-gate (designed), pending the infra to enforce them.

The "Top do-first" list at the end includes *only* proposals that pass both the evidence test (durable anchor) and the disjointness/feasibility test (disjoint oracle + buildable without absent infra).

**The three governing positions (§3.5) frame everything else** and answer the load-bearing questions: (G1) keep friction low — *friction is FP-rate × in-loop placement × firm-ratio, not check count; advisory-in-CI by default, promote on measured precision, replace bookkeeping rather than add it*; (G2) stay consistent — *a **derived** live AC/decision index enforced as graph-closure in CI, lifecycle gated by spec/ADR changes, structure-deterministic but meaning-human*; (G3) build gates via a **gate-factory loop** — *evidence-pulled, spec'd, shipped with a falsifying self-test, adversarially reviewed, validated on real history, born advisory and promoted to firm only on measured precision, and pruned by a periodic gate-retro*. Through-line: **measure before you mandate**; W0 is the keystone because it is both the enforcement runner *and* the measurement substrate the loop needs.

---

## 2. Enforcement Reality — Roster Installs the PROJECT's Enforcement Layer

**This is the correction that reframes the entire set, and it has two loci — the second matters far more.** "FIRM-GATE" is not a property of a proposal's logic; it is a property of *a runner in the target project that executes the check on an event and blocks on its exit code*.

- **Roster-repo enforcement (exists, low value):** `npm test` runs structure linters over roster's *own* files (`check-skill-structure.js`, `check-kb-links.js`, `check-spec-trace.test.sh`). This keeps the tool self-consistent. It enforces **nothing** in any project roster is used on.
- **Self-enforcement INTO the target project (the actual goal):** when roster is used on project X, it should — **with the user's consent and where X's capabilities allow** — *install and keep updated the enforcement substrate inside X* so the deterministic (and agentic/hybrid) gates run in X's own pipeline and block there, independent of the authoring agent. A gate written only into a skill is **agent-honored prose**; it becomes an *enforced* gate only when an independent runner in X recomputes the verdict and blocks. That runner is also the **disjoint oracle** of §3.

### What roster should install into the target (consent-gated · capability-detected · kept-updated)
1. **A project CI workflow** (`.github/workflows/roster-gates.yml`, GitLab CI, etc., per the detected platform) that runs the gates the project needs and **blocks merge** via required checks. The authoritative, most-disjoint layer — runs server-side; the agent can't `--no-verify` past it. Roster proposes it, **asks before writing**, and refreshes it as the gate set evolves.
2. **Agent-runtime hooks** — Claude Code hooks, Codex hooks, whatever runtime is in use — enforcing deterministic, **agentic**, or **hybrid** gates *during* the agent's work (PreToolUse block, PostToolUse check, an adversarial review sub-agent). Roster already builds Claude-Code hooks from its `hooks` layer into `.claude/settings.local.json`; extend this to other runtimes and to the target's policy.
3. **Git hooks** (pre-commit / pre-push) for fast local feedback — bypassable, so advisory relative to CI, but cheap and immediate.
4. **The helper scripts themselves**, projected into the target (e.g. `.roster/scripts/`), so the gates are runnable there — which also **resolves the dangling `$ROSTER_DIR` problem** (scripts now live in the project at a known path).

### Keep-updated, not install-once
These are projected artifacts that must be **maintained** as roster's gate set changes — the same source→projection + drift-check (`--check`) discipline roster already uses internally, now pointed at the target: a project whose `roster-gates.yml` has drifted from the current gate set is flagged and refreshed (with consent).

### Gates may be deterministic, agentic, or hybrid
Not everything installed is a script. The CI layer runs deterministic checks (build, tests, spec-trace, structure linters, advisory metrics); the agent-hook layer can run *agentic* or *hybrid* gates (an adversarial review sub-agent; an LLM check gated by a deterministic pre-filter). What makes any of them "enforced" is that it **runs in the project, on an event, outside the authoring agent's control** — regardless of its internal nature.

### Consequence for the proposals below
Almost every item previously tagged `blocked-on-infra` is unblocked by **one** workstream: the per-target enforcement installer (W0). And almost every `needs-disjoint-oracle` item is satisfied by the same thing — the target's CI/hook runner is the independent oracle. So W0 is not one proposal among many; it is the substrate the rest depend on, and the true do-first (see §8). C2's three-state rule (passed/failed/**not-reported**=NO-GO) only *means* anything once that runner emits a per-gate artifact.

### Helper scripts: exist vs proposed-but-absent
| Script | Status | Used by |
|--------|--------|---------|
| `check-spec-trace.sh` | **EXISTS** | C20 (its own header concedes "proves the back-link exists, NOT that the AC is satisfied") |
| `check-kb-links.js` | **EXISTS** | C17 dead-ref existence |
| `check-brief.sh` | **ABSENT — net-new build** | C6 |
| `validate-skill.sh` | **ABSENT — net-new build** | C6 |
| `route-state.ts` | **ABSENT — net-new build** | C3 |
| `run-gates.sh` | **ABSENT — net-new build** | C11 |
| `check-artifact-contracts.sh` | **ABSENT — net-new build** | C32 |

**Terminology used in the status column below:**
- **firm-gate (designed)** — logic is sound and disjoint; *would* hard-block once wired. Today it is agent-honored prose.
- **advisory** — measure and surface for human triage; must never hard-block correctness (the evidence does not support it as an oracle).
- **keep-agentic** — judgment that must not be mechanized; mechanizing only proof-of-execution.
- **needs-disjoint-oracle** — logic is sound but recomputes from an agent-authored input; firm only once an independent producer or a held-out, agent-uneditable oracle supplies the input.
- **blocked-on-infra** — sound in logic, inert until target CI wiring or an absent helper script exists.

No proposal below is marked simply "FIRM" without one of these qualifiers. That is the point of this document.

---

## 3. Disjointness / Input-Provenance — A First-Class Principle

**The single deepest finding of the adversarial pass.** Almost every "oracle" in the anchored set recomputes a verdict from an artifact the *same agent authored*: findings arrays (C1/C4), stated invariants (C13/C47), declared reads/writes (C32), agree-flags (C38), severity inputs (C9), policy rule sets (C15). Determinism over agent-chosen inputs is the document's own "garbage-in" caveat (originally Theme E) — but that caveat was applied **only to C9** and silently dropped everywhere else.

> **Principle (disjointness):** A verifier is sound only if its **inputs are not agent-controlled**. Recomputing `status = f(findings)` is deterministic, but if the agent writes `findings`, the agent can produce any `status` by curating the input — without ever lying about the tally. The oracle is disjoint from the *verdict string* but **not** from *what the agent optimizes*. Determinism is necessary; disjointness is what makes the verdict trustworthy.

**The generalized garbage-in rule (formerly the C9-only caveat, now global):** for every recompute-from-artifact proposal, the gate certifies only `output == f(input)`. It does **not** certify that `input` is complete, honest, or non-vacuous. Each such proposal therefore carries a **disjointness requirement**, satisfiable one of two ways:
- **(a) Independent producer** — the input is generated by a tool or agent the deciding agent cannot edit (a compiler, a held-out test suite, a separate reviewer pass with no write access to the artifact under judgment); or
- **(b) Held-out oracle** — a reference the agent cannot edit (a hidden test set, a version-controlled rule set under separate review, a mutant suite the agent did not author).

**Proposals carrying the disjointness requirement (marked `needs-disjoint-oracle` below):** C1, C4, C13, C15, C32, C38, C47, and the `open-critical` half of C4. C9 already carries it correctly. The honest framing for all of these: the gate raises the floor (it kills the dumbest failure — lying about a published tally) but cannot certify completeness of the agent-authored input. That residual must be stated wherever the proposal is advertised; in particular, C1/C4 must **not** be advertised as "removes the single most dangerous failure mode," because the likely failure (curating/down-severing the findings array) is untouched.

The held-out-oracle principle is **independently well-supported** and does not depend on the contested anchors discussed in §5 — it is the standard rationale behind train/test splits, hidden test sets in competitive evaluation, and mutation testing's "kill a mutant the author did not see." Where a proposal's only support was a future-dated paper, the disjointness *principle* still stands on this durable footing even though the specific numeric claims do not.

---

## 3.5 Governing Positions — Friction, Consistency, and How Gates Get Built

*(Maintainer positions, 2026-05-31. These govern the whole program; the proposal table (§4) is downstream of them. Through-line: **measure before you mandate** — every gate is born advisory and promoted to blocking only on measured evidence.)*

### G1 — Quality up, friction down
Friction is **not** a function of how many checks exist. It is roughly:
`friction ≈ false-positive-rate × in-loop-placement × firm-to-advisory-ratio` — minimize each:
- **Precision, not count.** A correct, fast, green check is invisible; friction is a gate that blocks legitimate work or nags. Spend the budget on precision (the FP-nag cluster — C22/C43/C45/C30 — is the friction, not the existence of gates).
- **Async CI over in-loop.** A check in the project's CI (W0) costs nothing in-loop; an in-loop agent gate costs latency+tokens every time. The deterministic class belongs in CI; reserve in-loop hooks for must-block-before-action (safety).
- **Advisory by default.** Block (firm) only for high-precision, evidence-strong, *disjoint* checks; everything else surfaces without blocking.
- **Replace, don't add.** Each check should replace an agentic self-report the skill already demanded ("verify gates pass" → `run-gates.sh`), not add a new obligation. Net friction is then often *negative* — the agent stops doing manual bookkeeping. We are not adding 47 obligations; we are mechanizing work the pipeline already nominally required.
- **Determinism *is* maintainability.** Prose conventions rot silently (observed this session: human-validation trap-wording drift; the recruiter feature dropped from a projection). Recomputed verdicts + kept-updated CI (`--check` drift) do not.

**Position:** advisory-in-CI by default; promote to firm only on proven precision; frame every gate as replacing existing bookkeeping. Friction stays ≤ today's, often below.

### G2 — Consistency: a *derived* live index, enforced as graph-closure
- The "live AC index" is a **view generated from `specs/**`, never a hand-maintained file** — a second source of truth is exactly the drift we keep hitting. `check-spec-trace` already materializes it.
- Enforce **graph-closure (no orphan nodes)** in CI: a code tag with no declaring spec → DANGLING; a declared AC with no reference → UNCOVERED; removing an AC while code still tags it → dangling. The `spec → AC → {code,test}` and `ADR → decision` graphs must stay closed.
- **Add/remove is gated by a spec/ADR change** — the same discipline as ADR supersede: an AC is born in a spec, referenced in code/tests, and retired only by the spec change that removes it (which carries the *why*).
- **Boundary:** structure-consistency is deterministic; *meaning*-consistency — is the AC good? does its test actually validate it? (tag ≠ satisfaction) — stays human.

**Position:** keep a derived index of ACs + decisions + entities; enforce closure in CI; gate the lifecycle on spec/ADR changes. The index is a materialized view, which is what stops it drifting.

### G3 — How gates get built: the gate-factory loop (EDD applied to the gates themselves)
Gates are produced by the same evidence-driven, disjoint, adversarially-gated, self-tested process they enforce. (We ran exactly this loop this session: audit → research → adversarial → fixed `check-spec-trace` with a falsifying self-test.)

**Demand — who decides what, and why (evidence-pulled, not invented):** a gate is *pulled* by observed recurrence — recurring **friction** (the skill-health log), an escaped **defect/miss** (cf. the battle-test "added after the L2-1372 miss" pattern), or an **adversarial-pass** finding. A proposal must cite its pulling evidence + an anchor — **no anchor, no gate.** *Agents propose from evidence; the human decides* (a firm gate changes everyone's workflow → human approval).

**Supply — produced / tested / validated (a gate is software, so it goes through EDD):**
1. **Spec the gate's contract** — what it proves *and what it does NOT* (the tag ≠ satisfaction honesty), firm-vs-advisory intent, evidence anchor, and a **disjointness analysis** (is the oracle independent of the authoring agent?).
2. **Build it with a falsifying self-test** — catches the bad case (fail) *and* passes the good case, with committed fixtures. **No negative self-test → vacuous → rejected** (we hit exactly this; the adversarial pass caught a positive-only fixture).
3. **Adversarially review it** (mandatory `roster-review` §3b) — vacuity, Goodhart, false positives; this is where firm-vs-advisory is pressure-tested (it demoted the metric thresholds).
4. **Validate by running on real history** — does it fire on the known miss it was built for? does it stay green on the current clean tree? (evidence-driven validation, not a code read).
5. **Promote firm ← advisory only on *measured* precision (shadow mode).** Every gate ships **advisory first**; measure FP/FN on real runs; "firm" is *earned*, never asserted. This is G1's friction control made into process.
6. **Keep updated + retire by evidence.** A periodic **gate-retro** (skill-health, but for gates) measures each gate's true-catch vs false-positive rate on real history and demotes/removes the ones that stop earning their place. The gate-set is **pruned, not accumulated.**

**Named tension (not papered over):** the gate-set itself can bloat / Goodhart (advisory noise; stale firm gates). The only defense is the gate-retro (step 6) — which requires **measuring gates on real history**. Therefore **W0 is also the measurement/audit substrate, not just an enforcement runner** — it must record per-gate outcomes over time. That is the deepest reason W0 is the keystone, and why the true first build is **W0 + its measurement substrate**, ahead of any individual gate.

---

## 4. Ranked Proposal Table

Sorted by value then effort. **FINAL STATUS** reflects the adversarial pass. Anchor strength: STRONG / MODERATE / WEAK-CONTESTED / **uncitable** (see §5). "→" denotes a change from the originally-designed status.

| ID | Proposal | Deterministic mechanism | Anchor + strength | FINAL STATUS | Value | Effort |
|----|----------|-------------------------|-------------------|--------------|-------|--------|
| C5 | TDD RED/GREEN from exit codes | RED≠0 (assertion-fail, not compile-error); GREEN==0 with new test in passed set; passed-before ≤ passed-after | RESEARCH Theme A/D **STRONG**; exit codes are a disjoint oracle | **firm-gate (designed)** — *requires C16 non-vacuity, or `assert True` fakes RED→GREEN* | high | small |
| C8 | Citation validator: every `path:line` resolves | each `path:line` exists in-range; each "unanswerable" carries a grep with 0 hits | RESEARCH Theme G/H **STRONG** for existence; file/line is a disjoint oracle | **firm-gate (designed)** — existence only; relevance keep-agentic | high | small |
| C17 | Dead-reference existence checks | extract path/symbol refs, existence-check via `check-kb-links.js` (EXISTS) + ctags | INTERNAL `ambiguity-auditor`; RESEARCH Theme F/G | **firm-gate (designed)** — clean disjoint oracle, script exists | high | small |
| C11 | Capture gate results to JSON; render table from it | `run-gates.sh` records exit/duration/counts; baseline-vs-final diff; reject COMPLETED+nonzero | RESEARCH Theme H **STRONG** (execution proof) | **firm-gate (designed) / blocked-on-infra** — `run-gates.sh` ABSENT; gate only "COMPLETED ⇒ all captured exits 0" | high | medium |
| C12 | Remove/quarantine flakiness before gating on tests | quarantine, pin seeds/inputs, don't promote flaky signals | RESEARCH Theme H **STRONG** (Luo FSE'14: Async-Wait ~45%, Concurrency ~20%, Test-Order ~12%) | **firm-gate (prerequisite)** — quarantine list must be **append-only + reviewed**; deflaking a test in the same change that would fail it is a hard stop | high | medium |
| C25 | Code size / complexity / duplication — MEASURE, do not gate | lizard/radon/gocyclo + jscpd/PMD-CPD; surface advisory, pin one tool+config/language | RESEARCH Theme J **WEAK-CONTESTED** (Shepperd'88; Landman JSEP'16; McCabe'76 "10 reasonable, not magical"; Kapser-Godfrey WCRE'06) | **advisory** — the best-anchored de-escalation in the set; the template for C7/C19/C33 | medium | medium |
| C14 | Generated/regression tests are characterization, not correctness | mark generated suites "behavior-unchanged" pins; never read green-generated-suite as correctness | RESEARCH Theme D **STRONG** (Shamshiri ASE'15: one suite detects 19.9% of 357 Defects4J faults) | **keep-agentic** (correctness) + firm-gate (regression pin) — correct refusal to over-claim | high | small |
| C24 | Friction clustering by group-by, LLM merge on top | `jq group_by` count matrix; threshold filter; proposals cite real counts | INTERNAL `roster-skill-health`; RESEARCH Theme L | **firm-gate (designed)** (counts) + keep-agentic (merge) | high | small |
| C29 | Investigate rows must cite evidence artifact | each CONFIRMED/REFUTED cites repro cmd+exit or query+`file:line`; non-repro attaches ≥1 failed attempt+exit | RESEARCH Theme H/C **STRONG** | **firm-gate (designed)** — artifact-presence; relevance & root-cause keep-agentic | medium | small |
| C1 | Recompute every verdict from an oracle | `status=GO iff count(findings: sev∈{CRIT,HIGH} ∧ OPEN)==0`; reject self-reported mismatch | INTERNAL `roster-review` Step 6; RESEARCH Theme A/B **STRONG** | **firm-gate (designed) + needs-disjoint-oracle** → narrowed: kills lying-about-tally, NOT curating-the-tally; findings completeness keep-agentic; pair C16/C19 | high | small |
| C4 | Merge/ship verdict bound to upstream exit-coded artifacts | `mergeable = all Tier-1 exits 0 ∧ approve ∧ open-critical==0` | INTERNAL `tech-lead` merge policy; RESEARCH Theme A/B **STRONG** | **firm-gate (designed)** on exit-coded half + **needs-disjoint-oracle** for `open-critical==0` (agent-curated) + **blocked-on-infra** | high | medium |
| C2 | Treat "not-reported" gate as NO-GO | distinguish passed/failed/not-reported; only `passed`=GO | RESEARCH Theme B **STRONG** | **firm-gate (logic) / blocked-on-infra** — inert until per-target CI emits a machine artifact per gate | high | small |
| C3 | YAML frontmatter `status:` enum; route by pure function | `route-state.ts`: yaml-load + enum-check | INTERNAL `roster-run`/`roster-ship`; RESEARCH Theme B **STRONG** | **firm-gate (routing only) / blocked-on-infra** — `route-state.ts` ABSENT; "parses" ≠ "valid" | high | medium |
| C6 | Brief/spec/skill structure linter family | `check-brief.sh` (required `##` non-empty + `status: VALIDATED`); `validate-skill.sh` | INTERNAL `roster-intake`/`roster-plan`; RESEARCH Theme G **MODERATE** (necessary-not-sufficient) | **firm-gate (structure only) / blocked-on-infra** — scripts ABSENT; **must reject vacuous fillers** (`TODO`/`N/A`/`tbd`/lorem) or it certifies empty scaffolds | high | small |
| C7 | Spec linter: counts, AC↔CHECK symmetry, traceability tags | count `### US-N`/`AC-N` ≥ tunables; AC↔CHECK symmetric-diff empty; tag uniqueness | INTERNAL `roster-spec`; RESEARCH Theme K **MODERATE-STRONG** (Mäder & Egyed EMSE'15) for traceability — **but NOT for count-floors** | **split:** symmetric-diff + tag-uniqueness = **firm-gate (designed)**; count-floor → **advisory** (Goodhart; C25-class; Mäder&Egyed never validated count thresholds) | high | medium |
| C13 | Manufacture oracles where no reference answer exists | metamorphic relations / PBT / differential | RESEARCH Theme C **STRONG** (Csmith PLDI'11: >325 compiler bugs) | **capability + needs-disjoint-oracle** → "a PBT exists" is NOT a firm pass; agent can state a tautological property; require ≥1 mutant killed (C16) before it gates | high | medium |
| C15 | Verdict-oracle via SARIF / policy-as-code | block on SARIF `level: error`; OPA/Conftest exit on Rego violation | RESEARCH Theme B **STRONG** | **firm-gate (designed) + needs-disjoint-oracle** — rule set is in-repo; empty/permissive Rego exits 0 forever; rule set must be VC'd + reviewed + fixture-tested | high | medium |
| C16 | Disjoint optimized-suite vs deciding-oracle + tamper detection | suite the agent edits ≠ oracle that decides; detect test-file edits; mutation-test the tests | RESEARCH Theme I — **uncitable** (EvilGenie arXiv:2511.21654 days-old; SpecBench arXiv:2605.21384 **this month, not citable**) | **WEAKEN — keep disjointness + edit-detection (firm, no paper needed); mutation-testing → advisory/opt-in (cost); DROP the STRONG label; re-anchor on PIT/Stryker mutation literature** | high | medium |
| C40 | Claim/term sets from markers, not judgment | RFC-2119/REQ-NNN parse; regex candidate + glossary set-diff | INTERNAL `spec-compliance-auditor`; RESEARCH Theme F **MODERATE-STRONG** | **firm-gate (extraction)**; NL-contradiction keep-agentic | high | medium |
| C44 | CHECK expected-output machine-comparable | roster-spec emits stdout/regex/exit expectation; N/A requires reason code | RESEARCH Theme A **STRONG**; Theme D caveat (don't pin a buggy expectation) | **firm-gate (designed)** — N/A-reason-code prevents silent skips | high | medium |
| C10 | Anti-hedging denylist on evidence strings | grep `probably\|likely\|seems` count must be 0 | INTERNAL "never probably" rule; RESEARCH Theme F **MODERATE-STRONG** (for *detection*) | **RECLASSIFY → advisory** — a zero-hedge gate removes the honest expression of doubt, not the doubt; violates the repo's anti-sycophancy rule; surface locations, never hard-block | high | small |
| C18 | Weasel-word/prose linting over KB files | Vale/textlint/proselint; exhaustive `file:line` hit list | INTERNAL `ambiguity-auditor`; RESEARCH Theme F **MODERATE-STRONG** | **firm-gate (detection) → triage keep-agentic** — must never silently become a zero-count gate (that collapses into C10) | high | small |
| C19 | Antipatterns as AST/semantic rules over the diff | semgrep/ast-grep/CodeQL rules | INTERNAL `reviewer`; RESEARCH Theme F **MODERATE-STRONG** — single-file matchers miss cross-file flows | **firm-gate (presence); absence keep-agentic** — **strip auto-severity** (re-imports C25 folklore); a rule firing sets *category*, severity routes through C9 | high | medium |
| C20 | Spec-compliance PASS bound to trace + coverage | spec-id tags + `check-spec-trace.sh` (EXISTS) + test in passed set | INTERNAL `spec-compliance-auditor`; RESEARCH Theme K/D | **firm-gate (presence); DIVERGE keep-agentic** — **replace `coverage>0` with "referencing test in the passed set"** (coverage>0 is gameable to vacuity) | high | medium |
| C32 | Artifact-contract chaining check | `check-artifact-contracts.sh`: downstream `reads ⊆ upstream writes` | INTERNAL `roster-skill-evolve`; RESEARCH Theme G **MODERATE** | **WEAKEN → advisory first / blocked-on-infra + needs-disjoint-oracle** — script ABSENT; hand-declared manifests lag prose → false blocks; firm only once manifests are *generated* from skills | high | medium |
| C9 | Confidence/severity as rubric over evidence class | confidence enum; severity = lookup `(category × magnitude × critical-path)`; override may only raise | INTERNAL `roster-review`; RESEARCH Theme E **MODERATE** (CVSS v4 bands; Leng *Taming Overconfidence*) | **firm-gate on label-consistency; severity assignment keep-agentic** — already correctly scoped; each category/band input must cite an evidence artifact (tie C29) | high | small |
| C21 | Config tunable type-validation | infer original type; assert new value parses same; re-parse YAML | INTERNAL `roster-config`; RESEARCH Theme G | **firm-gate (designed)** — narrow, sound, disjoint | high | small |
| C23 | Gate-command existence probe at intake | `command -v` + `--version`/`--help` | INTERNAL `roster-intake`; RESEARCH Theme H **STRONG** | **firm-gate (designed)** — cheap, sound, real | high | small |
| C28 | Findings dedup by fingerprint | group-by `path:line:category`, keep max severity | INTERNAL `roster-review`; RESEARCH Theme G | **firm-gate (designed)** — minor: severity of merged dup inherits agent guess | medium | small |
| C27 | Adversarial-pass proof-of-execution | require `specialist: adversarial` result object (even "no-break-found") | INTERNAL `roster-review` 3b; RESEARCH Theme H **STRONG** | **WEAKEN → liveness marker only** — presence is trivially satisfiable; proves the step was not skipped, nothing about quality; must NOT contribute to a GO score | medium | small |
| C30 | Init Mode B state from real signals | test cmd exit, lint count, `gh run list`, TODO grep | INTERNAL `roster-init`; RESEARCH Theme H **STRONG** | **firm-gate (designed)** — degrade gracefully; "CI unknown" ≠ "no CI" when `gh`/network absent | medium | small |
| C31 | New-script smoke proof | nominal exit==0 ∧ error-case exit≠0; optional `.bats` | INTERNAL `roster-skill-evolve`; RESEARCH Theme H **STRONG** | **firm-gate (designed)** — sound and cheap | medium | small |
| C33 | Research depth from computed sub-signals | `full if q>3 OR LOC>N OR files>M`; spawn researcher on trigger-lexicon regex | INTERNAL `roster-research`; RESEARCH Theme F **MODERATE-STRONG** for the *override*, **WEAK-CONTESTED** for the thresholds | **RECLASSIFY → advisory floor** — N/M are C25-class magic numbers; the *computation* is fine, the *thresholds* are folklore; override keep-agentic | medium | small |
| C34 | Force diagnostic interview on high-stakes lexicon | grep merge/rollback/deploy/governance → force on; never suppress | INTERNAL `team`; RESEARCH Theme L | **firm-gate (force-on only)** — asymmetric (only escalates); accept the paraphrase recall gap | low | small |
| C35 | Mode-selection contradiction catch (post-hoc) | Express chosen but `git diff` touched `kb/`/`specs/` → hard fail | INTERNAL `roster-run`; RESEARCH Theme L | **firm-gate (contradiction); mode choice keep-agentic** — asymmetric, sound | medium | small |
| C36 | Improvement-loop field & guard validation | field non-empty lint; `command -v` Verify/Guard; writable-glob file-count vs cap | INTERNAL `improvement-loop`; RESEARCH Theme H **STRONG** | **firm-gate (designed)** — document the cap as a **safety blast-radius bound**, not a quality/defect metric | medium | small |
| C37 | Discard "neutral + complexity" change | `metric unchanged ∧ (LOC delta>0 OR lint↑)` → discard | INTERNAL `improvement-loop`; RESEARCH Theme J **WEAK-CONTESTED** | **advisory** — already correct; depends on having a *valid* metric, else discards real improvements | medium | small |
| C38 | Plan dual-voice consensus from structured ids | per-item JSON ids + agree-flags → computed consensus | INTERNAL `roster-plan`; RESEARCH Theme G | **WEAKEN → firm bookkeeping only + needs-disjoint-oracle** — cannot certify *independence* of the two voices (one agent sets both flags); frame as tally, not consensus-proof | medium | medium |
| C39 | kb-search weights calibrated against a fixture | sweep weights vs labeled fixture; precision@k/recall@k regression | INTERNAL `kb-search`; RESEARCH Theme L | **WEAKEN → advisory** — "FIRM once fixture exists" overstates; a small hand-labeled fixture is noisy + overfit; keep advisory until holdout size justified | medium | medium |
| C41 | Structured-field contradiction check | bound-overlap for numeric/range conflicts; owner/enum mismatch | INTERNAL `kb-agent`; RESEARCH Theme L | **firm-gate (structured fields); prose keep-agentic** — correctly scoped to the diffable subset | medium | medium |
| C42 | Cross-spec entity-name collision detection | extract name→def map across specs; report collisions | INTERNAL `roster-spec`; RESEARCH Theme G | **firm-gate (detection/report only)** — never auto-block; name collision ≠ semantic collision | medium | small |
| C43 | Question budget counter | counter vs `max_questions_to_user` | INTERNAL `roster-spec`/`roster-init`; RESEARCH Theme G | **WEAKEN → warn-and-justify, not hard stop** — a hard cap can force proceeding under-specified, defeating the diagnostic-interview rule | medium | small |
| C45 | TUI golden-snapshot + scripted keypress | snapshot diff + no-truncation/no-traceback grep + keypress anchors | INTERNAL `roster-qa`; RESEARCH Theme H/C **STRONG** | **WEAKEN → firm only after pinning terminal dims/locale/seed (C12 applies); not a do-first** — snapshots are a classic flakiness source; high maintenance vs medium value | medium | large |
| C46 | Question "blindness" overlap check | token-overlap ratio vs task < threshold; prescriptive-verb grep | INTERNAL `roster-question`; RESEARCH Theme F — threshold **unanchored** | **advisory** (already) — ensure no one promotes the ratio to a gate; the prescriptive-verb grep is the useful half | high | medium |
| C47 | Invariant preservation by tagged method | PBT (run) / AST anti-pattern (0 hits) / not-verifiable allowlist | INTERNAL `code-quality-auditor`; RESEARCH Theme C **STRONG** + F **MODERATE-STRONG** | **WEAKEN + needs-disjoint-oracle** — "not-verifiable allowlist" is a self-issued waiver; entries must be **human-approved/append-reviewed**; PBT entries tie to mutant-kill (C16) for non-vacuity | medium | large |
| C22 | Commit format & in-scope-file lint | commitlint regex; `git status` ∖ declared file list | INTERNAL `roster-ship`; RESEARCH Theme G | **WEAKEN** — format lint firm; **file-scope check → advisory with whitelist** (generated/lock paths) or it nags on every legit `dist/`/`package-lock.json` edit; grouping keep-agentic | high | small |
| C26 | Auto-fix size threshold | `git diff --numstat` line-delta vs threshold | INTERNAL `roster-review`; RESEARCH Theme J **WEAK-CONTESTED** | **advisory (line-count) + keep-agentic (is-this-safe-to-auto-fix)** — security/race/behavior-change rows never auto-fix | medium | medium |

---

## 5. Evidence Down-Anchoring — The Uncitable Sources

Two anchors are **this-month / uncitable** and cannot be independently verified:
- **EvilGenie `arXiv:2511.21654`** — dated Nov 2025, days old at time of review.
- **SpecBench `arXiv:2605.21384`** — dated **May 2026 (this month)**; not yet citable.

These are the **sole STRONG anchor** for Theme I and therefore for **C16** — the proposal the source doc named a "do-first". The specific numeric claims attributed to them ("36–75% hack rate", "visible−held-out gap grows ~28pp/10× LOC", "adding visible tests sometimes widened the gap 25pp") **cannot be checked** and are treated as evidence-pending throughout.

**Re-anchoring decision:** C16's *value* does not actually depend on these papers. Its two cheap, sound halves — (i) keeping the suite the agent edits **disjoint** from the deciding oracle, and (ii) **test-file-edit detection** — rest on the durable, independently-supported held-out-oracle principle (§3): the same logic behind train/test splits and hidden evaluation sets. The mutation-testing layer re-anchors cleanly on **established mutation-testing literature (PIT, Stryker, and the broader mutation-testing body of work)**, which is well-supported and not future-dated. Action: **drop the STRONG label, keep the disjointness/edit-detection core as firm, demote mutation-testing-of-tests to advisory/opt-in on cost grounds, and re-anchor on PIT/Stryker rather than EvilGenie/SpecBench.** C16 is therefore *not* a do-first.

Any other proposal that leaned on these ids inherits the same treatment: the *principle* survives on the held-out-oracle footing; the *numbers* are marked evidence-pending and must not appear in a gate's justification.

---

## 6. Themed Narrative

### 6.1 Verdicts from an oracle — sound, but disjointness-limited (STRONG, narrowed)
Recomputing a status (`GO`, `COMPLETED`, `RED/GREEN`, `mergeable`) instead of trusting a self-reported one is the strongest *direction* in the set — Huang et al. (ICLR'24) and Stechly/Kambhampati (ICML'24) show intrinsic self-correction degrades reasoning while a *sound external verifier* gives large gains, and the critique content does not matter, only the pass/fail. C5 (exit codes) is the cleanest instance: exit codes are genuinely disjoint from the agent. C1/C4 are weaker than advertised: they recompute from a **findings array the agent authored**, so they kill the dumbest failure (lying about a published tally) while leaving the likely one (curating/down-severing the array) untouched (§3). They stay firm — they do raise the floor — but the claim is narrowed and they are paired with the disjointness requirement. C2's three-state model (passed/failed/**not-reported**=NO-GO) is the best *logic* in the set but inert without target CI wiring (§2).

### 6.2 Manufactured oracles & the limits of generated tests (STRONG, with a vacuity guard)
Where no reference answer exists, a sound oracle can be built from a stated invariant — metamorphic relations, PBT, differential (C13); Csmith found >325 compiler bugs purely by differential testing. The adversarial caveat: *the agent states the invariant*, so it can state a tautological one that never fails — the same vacuity class as `assert True`. A PBT existing is not a firm pass; it must have **killed ≥1 mutant** to count (ties to C16's mutation layer). The flip side (Theme D, STRONG): a *generated* suite asserts "behavior unchanged," not "correct" — Shamshiri (ASE'15) found a single generated suite detects only 19.9% of 357 Defects4J faults. C14 keeps the correctness call agentic; the adversarial pass calls it "the doc at its best — refusing to over-claim."

### 6.3 Flakiness first, and deflaking-as-gaming (STRONG prerequisite)
Every test-gated proposal silently assumes deterministic tests. Luo (FSE'14) categorizes flaky failures (Async-Wait ~45%, Concurrency ~20%, Test-Order ~12%); a test is a sound verifier only if the harness is deterministic. C12 precedes every test gate. The adversarial addition: "quarantine flaky" is itself a gaming lever — an agent can quarantine the test that would have failed and go green on a shrinking suite. So the quarantine list must be **append-only and reviewed**, and moving a test to quarantine in the same change that would make it fail is a hard stop. Otherwise "deflake" becomes "delete the inconvenient oracle." This same flakiness risk re-applies to C45 (terminal snapshots), which is why C45 is not a do-first.

### 6.4 The central reframing, applied uniformly: metric thresholds are advisory (WEAK-CONTESTED)
C25 — measure complexity/length/duplication but do not gate on fixed thresholds — is the **best-anchored analytical move in the whole document**. Shepperd (1988): cyclomatic complexity is a proxy for, and often outperformed by, LOC. Landman/Serebrenik/Vinju (JSEP'16, 17.6M Java methods): only *moderate* CC↔LOC correlation. McCabe (1976) himself called 10 "reasonable, not magical"; no canonical study fits 10/15/20 as a defect-optimal cutpoint. Kapser & Godfrey (WCRE'06): clones are not consistently more defect-prone. The adversarial pass's sharpest structural point is that the source doc applied this reasoning **selectively** — it condemned thresholds in C25 then gated on them in C7 (count-floors), C19 (auto-severity), C33 (depth floors), and C46 (overlap ratio). **This final document reconciles them: every fixed-threshold-as-quality-oracle is advisory.** C7's count-floor is demoted (its symmetric-diff and tag-uniqueness halves, which are real structural invariants, stay firm); C19 loses auto-severity (a rule firing sets *category*; severity routes through C9); C33's floor is advisory; C46 stays advisory. The lone defensible exception is C36's file-count *cap*, which is reframed explicitly as a **blast-radius safety bound**, not a defect metric — a different justification that survives.

### 6.5 Goodhart / disjointness as the real defense (re-anchored)
Any proxy used as a target gets gamed, including a deterministic one. The defense (C16) is structural: the suite the agent optimizes must be disjoint from the oracle that decides, with tamper detection. The adversarial pass correctly flags that C16 was both the most load-bearing proposal *and* the worst-anchored (its STRONG label rested entirely on the two uncitable papers, §5), and that it is partly self-referential — C16 is invoked to rescue C5/C7/C13/C47, yet C16's own held-out suite is authored by the same pipeline. Resolution: keep the disjointness + edit-detection core (cheap, sound, needs no paper, rests on the held-out-oracle principle of §3), demote mutation-testing to advisory/opt-in on cost, re-anchor on PIT/Stryker, and remove C16 from the do-first list.

### 6.6 Detection vs triage, and the C10 self-contradiction (MODERATE-STRONG)
Detection tasks become rule engines feeding human triage: Vale/proselint for weasel words (C18), semgrep/CodeQL for antipatterns (C19), marker extraction (C40). Two bounds: single-file matchers miss cross-file flows, so **absence is not proof of absence** (C19 keeps absence agentic); and the agent triages the exhaustive hit list rather than the gate emitting a verdict. **C10 is the cautionary failure here** — a hard *zero-count* gate on `probably|likely|seems` does not remove uncertainty, it removes its honest expression. An agent passes by deleting the qualifier, turning "probably exploitable" into "exploitable" — a *more* confident, *less* accurate claim. This directly violates the repo's own anti-sycophancy rule ("do not add qualifiers to soften... state what the evidence says" *and* "never upgrade to match the framing"). C10 is reclassified to advisory: surface the hedge-word locations, never block. C18 is the correct version of the same idea precisely because it is detection→triage, not a zero-count gate.

### 6.7 False-positive nags that erode trust (operational)
A cluster of gates can block legitimate work and must be softened: C22 file-scope on generated/lock paths (whitelist + advisory), C43 hard question cap (warn-and-justify, not hard stop — it conflicts with the diagnostic-interview rule), C45 snapshot flakiness (pin dims/locale/seed), C30 absent-`gh` mis-inference ("CI unknown" ≠ "no CI"). None are catastrophic, but each erodes trust in the whole gate layer.

---

## 7. Keep-Agentic — Judgment That Must Not Be Mechanized

The over-correction hazard. Mechanizing these manufactures false confidence or rewards vacuous artifacts.

- **Adversarial review reasoning** (`roster-review` 3b) — breaking a change, spotting Goodhart/vacuous tests, blast radius. Mechanize only *liveness* (C27), which proves the step ran and nothing about quality; its presence must not feed a GO score.
- **Severity/priority assignment per finding** (C9) — the rubric removes drift; "is this a real security bug? P0 vs P1?" stays human; override may only raise, and each band input must cite evidence (else the lookup launders a guess).
- **DIVERGE detection** (C20) — a trace tag proves a test *exists*, never that behavior *matches*; DIVERGE must cite the specific behavioral difference.
- **Root-cause synthesis** (C29) — connecting evidence into a causal story; only the post-test confidence label is evidence-derived.
- **Natural-language contradiction** (C41) — prose contradiction is not a diff; only the structured-field subset (numbers, owners, enums, bounds) is mechanizable.
- **"What vs how" mode selection** (C35) — the deterministic layer only catches contradictions *after the fact*.
- **"One logical change" commit grouping** (C22) — only the lintable surface (format, length, casing) is mechanical.
- **Cross-module coupling / architecture-fit** — not reducible to a line count.
- **Free-text friction "same workaround" merge** (C24) — LLM merge on top of deterministic grouping.
- **Whether a clone is worth refactoring / a duplicate is intentional** (C26) — detection is mechanical; the refactor decision is judgment; security/race/behavior-change rows never auto-fix.
- **Absence-of-finding from a single-file matcher is not proof of absence** (C19) — the absence claim stays agentic.
- **Correctness from generated tests** (C14) — a green generated suite proves regression-stability, not correctness.
- **Completeness/honesty of any agent-authored input** (§3) — the gate certifies `output == f(input)`, never that `input` is complete. This is the *generalized* garbage-in boundary, applying to C1, C4, C13, C15, C32, C38, C47 — not just C9.

**The recurring guardrail:** a schema-green or lint-green artifact must never be read as "correct." The linter proves the structure is well-formed (necessary-not-sufficient); the human/substance gate stays. And the load-bearing property across every theme is verifier *validity + disjointness*, not that the output is the same each run — a flaky-but-sound test must be fixed (C12); a deterministic-but-invalid threshold must be demoted (C25); a deterministic recompute over an agent-authored input must carry the disjointness requirement (§3).

---

## 8. Top Do-First — Evidence-Solid AND Enforceable

Inclusion test (both must hold): **(1) durable anchor** — not resting on the uncitable §5 papers; and **(2) disjoint + feasible** — a disjoint oracle (input not agent-controlled, or an honest detection→triage scope) *and* buildable without absent merge infra. Proposals that are sound-but-`blocked-on-infra` (C2, C3, C11) or sound-but-`needs-disjoint-oracle` (C1, C4, C13, C15, C32, C38, C47) or anchor-pending (C16) are deliberately **excluded** from do-first and listed as fast-follows.

**W0 (prerequisite, the real #1) — the per-target enforcement installer.** Roster gains the ability to install & maintain, in the project it works on (consent-gated, capability-detected): a **CI workflow** that runs the project's gates and blocks merge; **agent-runtime hooks** (Claude/Codex/…) for deterministic/agentic/hybrid in-loop gates; **git hooks**; and the **helper scripts** under `.roster/` (which also fixes `$ROSTER_DIR`). Extend roster's existing source→projection + `--check` discipline to these target-side artifacts so they stay current. *W0 converts every `blocked-on-infra` proposal into an enforced gate and supplies the disjoint oracle every `needs-disjoint-oracle` proposal requires. Build the CI-workflow track first (most disjoint), hooks second.* Everything below assumes W0 or runs as agent-honored prose until it lands.

**Do-first proposals (survive both tests; become *enforced* once W0 runs them):**

1. **C12 — deflake before any test gate**, with append-only/reviewed quarantine and the same-change-quarantine hard stop. *STRONG; disjoint (a fixed harness is the precondition for every other test oracle); cheap relative to blast radius.*
2. **C5 — RED/GREEN from exit codes**, distinguishing assertion-fail from compile-error and requiring the new test in failed-then-passed sets. *STRONG; exit codes are genuinely disjoint. Caveat: pair with a non-vacuity check so `assert True` cannot fake it — the disjointness/edit-detection half of C16, which needs no paper.*
3. **C8 + C17 — citation/dead-reference existence** (`check-kb-links.js` already exists; the 0-hit grep for "unanswerable" is the strongest half). *STRONG; file/line existence is a clean disjoint oracle; cheap.*
4. **C25 — demote code-metric thresholds to advisory**, and apply the same treatment to C7's count-floor, C19's auto-severity, C33's depth floor, C46's ratio. *WEAK-CONTESTED but well-anchored as a *de-escalation*; closes the document's own selective-application inconsistency; removes a Goodhart hole at near-zero cost.*
5. **C14 — generated tests are characterization, not correctness.** *STRONG; pure de-escalation; the correct refusal to over-claim; zero infra.*
6. **C29 — investigate rows must cite a repro cmd+exit or query+file:line.** *STRONG; artifact-presence floor; disjoint on existence (relevance stays agentic); cheap.*
7. **C10 (as advisory) — surface hedge-word locations for triage.** *Included specifically as the *corrected* form: detection→triage, never a zero-count gate; resolves the most self-contradictory item in the set.*

**Fast-follow once their precondition is met (not do-first):**
- **C2 / C3 / C11** — sound, but require per-target CI wiring / the absent `route-state.ts` / `run-gates.sh` (§2).
- **C1 / C4** — firm on the exit-coded half, but the findings-array half needs an independent producer (§3); ship narrowed, advertise honestly.
- **C16** — disjointness + test-file-edit detection can ship now (durable principle); mutation layer is advisory and re-anchored on PIT/Stryker; not a do-first until evidence-pending anchors are replaced.
- **C6** — needs `check-brief.sh` + the vacuous-filler denylist before it certifies anything.
