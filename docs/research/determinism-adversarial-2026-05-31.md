# Adversarial Review — Determinism Improvements (C1–C47)

*Red-team pass over `determinism-improvements-anchored-2026-05-31.md`. Mandate: BREAK the
proposals. Verdicts: **SOUND** (survives as proposed), **WEAKEN** (real but oversold — narrow
the claim), **RECLASSIFY** (wrong status — usually firm→advisory or firm→keep-agentic),
**DROP** (vacuous, ungrounded, or net-harmful as a gate).*

## Grounding checks performed (not asserted)

- **Harness model:** skills are prompt-projected markdown (`skills/pipeline/*.md`,
  `.claude/commands/*.md`) executed by an agent. There is *also* a CI/Node runtime
  (`npm test` builds TS, runs `check-skill-structure.js`, `check-kb-links.js`,
  `check-spec-trace.test.sh`). **Crucial distinction the source doc blurs:** CI today lints
  the *roster's own files* for structure; it does **not** bind any per-target GO/NO-GO to a
  script exit. A "FIRM-GATE" written into a skill's prose is still agent-executed unless and
  until someone builds a per-target verifier *and wires it into the target repo's merge event*.
  Most "firm gates" below assume that wiring exists. It does not yet, for any target.
- **Cited scripts:** `check-spec-trace.sh` ✅ exists, `check-kb-links.js` ✅ exists.
  `check-brief.sh`, `validate-skill.sh`, `route-state.ts`, `run-gates.sh`,
  `check-artifact-contracts.sh` — **do not exist.** The doc writes "(exists)" against
  `check-spec-trace.sh`/`check-kb-links.js` (true) but presents the others as if shippable;
  they are net-new build, not wiring.
- **Future-dated anchors:** EvilGenie `arXiv:2511.21654` = Nov 2025; SpecBench
  `arXiv:2605.21384` = **May 2026 (this month)**. Both are the *sole* STRONG anchor for Theme I
  and for C16 — the proposal the doc names a "do-first" top action. A load-bearing firm
  anti-gaming gate rests on one paper that is ~weeks old / unverifiable and one not yet
  citable. The numeric claims ("36–75% hack rate", "gap grows 28pp/10× LOC", "adding visible
  tests widened the gap 25pp") cannot be independently checked. Treated as a known liability
  throughout.

---

## Verdict Table

| ID | Primary attack | Verdict | Concrete fix |
|----|----------------|---------|--------------|
| C1 | Recompute GO from findings array — but the *findings array itself* is agent-authored. Oracle is disjoint from the verdict string, **not** from the input the agent controls. Agent gets GO by omitting/down-severing the HIGH, not by faking the status. Closes the *least* likely failure (lying about the tally), not the likely one (curating the tally). | **WEAKEN** | Keep as firm gate (it does kill the dumbest failure) but state the residual: the gate proves status==f(findings), never that findings is complete. Findings completeness stays keep-agentic; pair with C16/C19. Do not advertise as "removes the single most dangerous failure mode." |
| C2 | Strongest in the set: three-state passed/failed/not-reported. Attack: in a prompt harness with no merge wiring, "not-reported" is indistinguishable from "ran-and-passed" unless a real CI event records it. The rule is sound; the *substrate to enforce it* is the missing `merge_group` wiring. | **SOUND** (logic) / blocked on infra | Ship the rule, but it is inert until per-target CI emits a machine artifact per gate. Mark as "FIRM-GATE — requires target CI wiring; advisory until then." |
| C3 | YAML `status:` enum routed by pure function. Solid and cheap. Attack: `route-state.ts` does not exist, and the agent that *writes* the frontmatter is the same one whose verdict it encodes — parse-correctness ≠ verdict-correctness. | **SOUND** (as a routing/parse gate only) | Build the parser; never let "status: VALIDATED parses" imply the brief is valid. It gates routing, not truth. |
| C4 | `mergeable = all Tier-1 exits 0 ∧ approve ∧ open-critical==0`. Same disjointness hole as C1 (`open-critical` is agent-curated) plus same wiring gap as C2. | **WEAKEN** | Bind the exit-coded half (Tier-1 exits) firmly; treat `open-critical==0` as advisory-derived-from-agent-input until findings provenance is itself verified. |
| C5 | RED/GREEN from exit codes, distinguish assertion-fail vs compile-error, passed-before ≤ passed-after. Genuinely sound — exit codes are a disjoint oracle. Attack: agent writes a test that asserts nothing (`assert True`) → RED phase faked as GREEN-by-construction, or writes RED via a typo (NameError) that the "compile-error" filter is supposed to catch but won't across dynamic langs. | **SOUND** (with caveat) | Keep firm. Require the new test to be in the *failed* set in RED and the *passed* set in GREEN (doc says this) AND mutation-check the new test (C16) so `assert True` is caught. Without C16 this is gameable. |
| C6 | Structure linter (required `##` non-empty + `status: VALIDATED`). Pure vacuity risk: "non-empty `##`" is satisfied by a heading followed by "TODO" or "N/A". Proves layout, not content. Doc admits "structure only". | **SOUND** (as scoped) | Keep, but the lint must reject known-vacuous fillers (`TODO`, `N/A`, `tbd`, lorem) in required sections, or it certifies empty scaffolds as VALIDATED. `check-brief.sh` does not exist — net-new. |
| C7 | Spec linter: counts ≥ tunables, AC↔CHECK symmetric-diff empty, tag uniqueness. Goodhart: "≥ N user stories" is met by splitting one story into N, or padding ACs that map 1:1 to trivial CHECKs. AC↔CHECK symmetry proves *pairing*, never that the CHECK tests the AC. | **WEAKEN** | Drop the count-floor as a *gate* (it is a C25-class folklore threshold — demote to advisory); keep symmetric-diff + tag-uniqueness as firm (those are real structural invariants). Anchor borrows Mäder&Egyed (traceability *helps developers*) to justify count-floors it does not support. |
| C8 | Citation validator: every `path:line` resolves in-range. This is genuinely sound — file/line existence is a disjoint, recomputable oracle. Attack: resolves-in-range ≠ supports-the-claim; agent cites a real line that says nothing relevant. | **SOUND** (existence only) | Keep firm for existence. State plainly that a resolving citation is necessary-not-sufficient; relevance stays agentic. The "0-hit grep for unanswerable" half is the strongest part — keep it. |
| C9 | Severity = lookup(category × magnitude × critical-path). The doc *itself* flags the garbage-in hole (agent picks inputs to hit a band) and correctly keeps assignment agentic, gating only label-consistency. That is the right call. Residual attack: "override may only raise" is gameable downward by mis-stating the base category. | **SOUND** | Already correctly scoped (firm on label==lookup, agentic on inputs). Add: the *category/band inputs* must each cite an evidence artifact (tie to C29), else the lookup launders a guess. |
| C10 | Anti-hedging denylist: `probably|likely|seems` count must be 0. Pure Goodhart and actively harmful as a gate: it punishes calibrated uncertainty. Agent passes by deleting the word, not the doubt — "this is probably exploitable" → "this is exploitable" makes the claim *worse* and the submission *more* likely to overstate. Directly conflicts with the repo's own anti-sycophancy rule (which forbids softening AND forbids false confidence). | **RECLASSIFY → ADVISORY** | Surface hedge-word locations for human triage; never hard-block. A zero-hedge gate manufactures false confidence — exactly the failure the whole doc claims to fight. This is the most self-contradictory firm gate in the set. |
| C11 | Capture gate results to JSON, reject COMPLETED+nonzero. Sound execution-proof. Depends on `run-gates.sh` (does not exist) and assumes deterministic tests (C12). | **SOUND** (execution proof) | Build it; gate only "COMPLETED ⇒ all captured exits 0", which is real. Do not let captured-green imply correct. |
| C12 | Remove flakiness before gating. Correct and under-weighted by the audit — agree. Attack: "quarantine flaky" is itself a gaming lever — an agent (or a flaky-by-fix) quarantines the test that would have failed, and the gate goes green on a shrinking suite. | **SOUND** (with guard) | Keep as prerequisite. Add: quarantine list is append-only + reviewed; a test moving to quarantine in the same change that would make it fail is a hard stop. Otherwise "deflake" becomes "delete the inconvenient oracle." |
| C13 | Manufacture oracles (metamorphic/PBT/differential). Genuinely the strongest *positive* idea (Csmith is real, STRONG). Attack: "FIRM-GATE where invariant stated" — the agent states the invariant, so it can state a weak/tautological one (a metamorphic relation that always holds). Oracle strength = agent-chosen. | **SOUND → WEAKEN on the gate** | Keep as a capability; do not make "a PBT exists" a firm pass. A property that never fails is vacuous (same class as `assert True`). Require the property to have killed ≥1 mutant (C16) before it counts as a gate. |
| C14 | Generated tests = characterization not correctness. Correctly keep-agentic on the correctness call. No attack — this is a *de*-escalation and it is right (Shamshiri 19.9% is real). | **SOUND** | None. This is the doc at its best: refusing to over-claim. |
| C15 | SARIF `level: error` / OPA-Conftest as verdict oracle. Sound *if* the rules exist and are non-trivial. Attack: the ruleset is authored in-repo; an empty/permissive Rego policy exits 0 forever — green policy ≠ safe. Oracle is only as disjoint as the rules are independent of the agent. | **SOUND** (with caveat) | Keep firm on "a declared rule fired", but the *rule set* must be version-controlled, reviewed, and mutation/fixture-tested, or it is a self-graded exam. |
| C16 | The anti-gaming firm gate — disjoint suite + tamper detection + mutation testing. The single most load-bearing proposal AND the worst-anchored: its entire STRONG label rests on EvilGenie (Nov 2025, days old) and SpecBench (May 2026, **not yet citable**). Mutation testing also adds large latency/cost. And it is partly self-referential: the doc invokes C16 to rescue C5/C13/C7 from gaming, but C16's own oracle (the held-out suite) is authored by the same pipeline. | **WEAKEN** (keep the idea, drop the STRONG label) | Keep disjointness + test-file-edit detection (cheap, sound, no paper needed). Demote mutation-testing-of-tests to advisory/opt-in (cost). Re-anchor on established work (PIT/Stryker mutation literature, not EvilGenie/SpecBench). Do not call it a "do-first" until anchored on verifiable evidence. |
| C17 | Citation/dead-ref existence + ctags. Same class as C8, real and cheap (`check-kb-links.js` exists). | **SOUND** | None — existence check is a clean disjoint oracle. |
| C18 | Weasel-word/prose lint (Vale), detection firm + triage agentic. Correctly scoped (detection ≠ verdict). Mild overlap with C10's bad idea, but here it is *detection feeding triage*, not a zero-count gate — that distinction is the right one. | **SOUND** | Keep. Ensure it never silently becomes a zero-count *gate* (that would collapse into C10's failure). |
| C19 | Antipatterns as AST rules; presence firm, absence agentic. Correctly bounded (single-file matchers miss cross-file → absence ≠ proof). Attack: "severity = rule's declared band" re-imports the C25 folklore problem one level up — who calibrated the rule's band? | **SOUND** (presence) | Keep. Strip the auto-severity claim; a rule firing sets *category*, not severity — severity still routes through C9's agentic assignment. |
| C20 | Spec-compliance PASS requires test-ref ∧ coverage>0; DIVERGE keep-agentic. `check-spec-trace.sh` exists and its own header explicitly says "proves the back-link exists, NOT that the AC is satisfied" — the proposal is honest. Attack: coverage>0 is a near-zero bar; one line executed = "covered". | **SOUND** (with caveat) | Keep firm on presence. Replace `coverage>0` with "the referencing test is in the passed set" (C5) — coverage>0 is gameable to vacuity. |
| C21 | Config tunable type-validation (re-parse YAML, type unchanged). Narrow, sound, disjoint. | **SOUND** | None. |
| C22 | Commit format lint + in-scope-file check; grouping keep-agentic. Sound. Attack: `git status ∖ declared-file-list` produces false positives on legit incidental edits (lockfiles, generated dist/) → blocks legitimate work. | **WEAKEN** | Keep format lint firm; make the file-scope check advisory with a whitelist (generated/lock paths), or it will nag on every real commit that touches `dist/`/`package-lock.json`. |
| C23 | Gate-command existence probe (`command -v` + `--version`). Cheap, sound, real. | **SOUND** | None. |
| C24 | Friction clustering by `jq group_by`, LLM merge on top. Counts firm, merge agentic — correct. | **SOUND** | None. |
| C25 | Code size/complexity/duplication — MEASURE not gate. The doc's central reframing and it is *correct* (Shepperd/Landman/McCabe/Kapser are real, the threshold-as-defect-oracle is folklore). This is the strongest analytical move in the document. | **SOUND** | None — this de-escalation is well-anchored and should be the template for C7's count-floors and C19's auto-severity. |
| C26 | Auto-fix size threshold, advisory + "is-this-safe-to-auto-fix" keep-agentic. Correct. | **SOUND** | None. |
| C27 | Adversarial-pass proof-of-execution: require a `specialist: adversarial` result object, even "no-break-found". Pure Goodhart: the object's *presence* is trivially satisfiable by emitting `{specialist: adversarial, result: "no break found"}` having done nothing. Proves a string exists, not that adversarial reasoning happened. | **WEAKEN** | Keep as a *liveness* marker only and say so loudly: it proves the step was not skipped, nothing about quality (doc concedes this). Do not let its presence contribute to a GO score, or it becomes a free pass. |
| C28 | Findings dedup by fingerprint `path:line:category`. Sound, mechanical. Attack: keeps max severity — if two dups disagree on severity the merge inherits the agent's severity guess. Minor. | **SOUND** | None material. |
| C29 | Investigate rows must cite repro cmd+exit or query+`file:line`; non-repro attaches ≥1 failed attempt+exit. Strong: forces an artifact. Attack: a cited "repro cmd + exit 0" can be a command that exercises nothing; existence ≠ relevance (C8 class). | **SOUND** | Keep firm on artifact-presence; relevance stays agentic. This is one of the better firm gates — it raises the floor without claiming correctness. |
| C30 | Init state from real signals (test exit, lint count, `gh run list`, TODO grep). Sound, disjoint. Attack: `gh run list` assumes GitHub + network + auth; absent in many targets → false "no CI" inference. | **SOUND** (with caveat) | Keep; degrade gracefully — "CI unknown" ≠ "no CI". Do not branch logic on an absent-tool null. |
| C31 | New-script smoke proof (nominal exit 0 ∧ error-case exit≠0). Sound and cheap. | **SOUND** | None. |
| C32 | Artifact-contract chaining: downstream reads ⊆ upstream writes. Conceptually sound. `check-artifact-contracts.sh` does not exist (net-new), and "writes/reads" sets must be declared by the skill author → declaration drift gives false positives. | **WEAKEN** | Worth building, but start advisory: the reads/writes manifest is hand-maintained and will lag the prose, producing false blocks. Firm only once manifests are generated from the skills, not hand-declared. |
| C33 | Research depth from sub-signals (`q>3 OR LOC>N OR files>M`), override keep-agentic. The N/M are C25-class magic numbers presented as a firm "computed floor". | **RECLASSIFY → ADVISORY floor** | The *computation* is fine; the *thresholds* are folklore (same evidence class the doc demoted in C25). Call the floor advisory, not firm, or it is exactly the inconsistency the doc warns against. |
| C34 | Force diagnostic interview on merge/rollback/deploy/governance lexicon; force-on only, never suppress. Asymmetric (only escalates) → safe failure mode. Attack: lexical grep misses paraphrase ("retire the old service" ≠ "rollback") → false negatives, but never false-blocks. | **SOUND** | None — force-on-only is the right asymmetry. Accept the recall gap. |
| C35 | Mode-selection contradiction catch: Express chosen but diff touched `kb/`/`specs/` → hard fail. Sound post-hoc contradiction check, asymmetric. | **SOUND** | None. |
| C36 | Improvement-loop field/guard validation + writable-glob file-count cap. Mostly sound. The file-count *cap* is a magic number (C25 class) but here it is a blast-radius safety limit, not a quality oracle — different justification, defensible. | **SOUND** | Keep; document the cap as a safety bound, not a quality metric, so it is not mistaken for a defect gate. |
| C37 | Discard "neutral + complexity" change: `metric unchanged ∧ (LOC delta>0 OR lint↑)`. Correctly advisory. Attack: "metric unchanged" depends on having a valid metric; if the metric is itself agent-asserted this discards real improvements. | **SOUND** (advisory) | None — already advisory. |
| C38 | Plan dual-voice consensus from per-item ids + agree-flags; reasoning keep-agentic. Goodhart: agreement is computed from flags the same agent sets for both voices → "dual voice" can be one voice wearing two hats, both flags = agree. Structure proves flags were emitted, not that two independent judgments occurred. | **WEAKEN** | Keep the structural tally firm, but it cannot certify *independence* of the two voices — the core value claim of "dual-voice consensus" is not verifiable by this gate. Frame as bookkeeping, not consensus-proof. |
| C39 | kb-search weights calibrated against a fixture; "ADVISORY → FIRM once fixture exists". The fixture is the oracle and it is hand-labeled by the same team → overfit-to-fixture risk; precision@k on a tiny fixture is noisy. | **WEAKEN** | Fine to calibrate, but "FIRM once fixture exists" overstates — a 20-row fixture is not a defensible regression gate. Keep advisory until fixture size/holdout is justified. |
| C40 | Claim/term sets from RFC-2119/REQ markers; NL-contradiction keep-agentic. Extraction is mechanical and sound; correctly bounded. | **SOUND** | None. |
| C41 | Structured-field contradiction (numeric/range/owner/enum); prose keep-agentic. Correctly scoped — only the diffable subset. | **SOUND** | None. |
| C42 | Cross-spec entity-name collision detection. Detection mechanical, sound. Attack: name collision ≠ semantic collision (two different `Order`s may be fine); reporting is right, gating would false-positive. | **SOUND** (detection/report) | Keep as detection+report, never auto-block — doc already says "detection". |
| C43 | Question budget counter vs `max_questions_to_user`. Mechanical, sound. Attack: hard cap can truncate a genuinely needed clarification → blocks legitimate work (false positive against the diagnostic-interview rule). | **WEAKEN** | Keep the counter; make the cap a *warn-and-justify*, not a hard stop — a hard question cap can force an agent to proceed under-specified, which the interview protocol exists to prevent. |
| C44 | CHECK expected-output machine-comparable (stdout/regex/exit), N/A needs reason code. Sound — turns eyeballing into a comparison. Theme D caveat (don't pin a buggy expectation) is real and acknowledged. | **SOUND** | Keep. The N/A-reason-code requirement is good (prevents silent skips). |
| C45 | TUI golden-snapshot + scripted keypress; aesthetics keep-agentic. Sound but **large** effort and snapshot tests are a classic flakiness/maintenance source (terminal size, locale, timing) — risks importing the very non-determinism C12 fights. | **WEAKEN** | Keep snapshot-diff firm only after pinning terminal dims/locale/seed (C12 applies to snapshots too). High maintenance cost vs medium value — not a do-first. |
| C46 | Question "blindness" overlap: token-overlap ratio < threshold. Doc admits the threshold is "unanchored". A token-overlap ratio is a crude proxy for "leaked solution intent" — high false positives (shared domain vocab) and trivially gamed (synonyms). | **RECLASSIFY → ADVISORY** (doc already says advisory) | Correctly advisory already; just ensure no one promotes the ratio to a gate. The prescriptive-verb grep is the more useful half. |
| C47 | Invariant preservation by tagged method (PBT run / AST 0-hits / not-verifiable allowlist). Sound *structure*, but the "not-verifiable allowlist" is an open escape hatch: an agent tags hard invariants as "not-verifiable" to dodge the gate. Plus PBT-exists ≠ PBT-strong (C13 class). | **WEAKEN** | Keep; but the not-verifiable allowlist must be append-reviewed (a human approves entries), else it is a self-issued waiver. Tie PBT entries to mutant-kill (C16) for non-vacuity. |

---

## The 5 most dangerous proposals (as gates)

1. **C10 — anti-hedging zero-count gate.** The most self-contradictory item. A hard gate
   that forbids `probably|likely|seems` does not remove uncertainty — it removes the *honest
   expression* of it. An agent satisfies it by deleting the qualifier, producing a *more*
   confident, *less* accurate claim. It directly violates the workspace's own anti-sycophancy
   rule ("do not add qualifiers to soften... state what the evidence says" *and* "never upgrade
   to match the user's framing"). As a firm gate it manufactures exactly the false confidence
   the document exists to prevent. Must be advisory.

2. **C16 — disjoint-suite + mutation, the "do-first" anti-gaming gate.** Load-bearing for the
   whole anti-Goodhart story, yet its STRONG label rests entirely on **EvilGenie (days old)**
   and **SpecBench (arXiv id dated this month, not citable)**. A firm gate justified by
   unverifiable evidence is a governance liability: if those numbers don't hold, every
   downstream "C16 protects this" claim (C5, C7, C13, C47) collapses. The disjointness +
   tamper-detection core is sound and needs no paper; the mutation-testing layer is costly and
   should not be a do-first. Re-anchor on established mutation-testing literature; drop the
   STRONG label until the anchors are verifiable.

3. **C1/C4 — "recompute the verdict from the findings array."** Marketed as removing "the
   single most dangerous failure mode." It removes the *least* likely one (an agent lying about
   a tally it published) while leaving the *likely* one untouched (the agent curating or
   down-severing the findings array that feeds the oracle). The deciding oracle is **not
   disjoint from what the agent optimizes** — the agent writes the array. This is false
   confidence dressed as soundness; it must be paired with provenance/completeness checks and
   its claim narrowed.

4. **C7 — spec linter count-floors as a firm gate.** "≥ N user stories / AC-N / C-N" is a
   textbook Goodhart number: met by splitting one story into N or padding 1:1 trivial ACs.
   It borrows Mäder & Egyed (traceability *helps developers*) to justify *count thresholds*
   that study never validated — the same folklore-as-determinism move the document correctly
   condemns in C25, committed inside a "firm gate". Inconsistent with the doc's own thesis.

5. **C33 — research-depth "computed floor" `LOC>N OR files>M`.** Presented as FIRM while
   resting on magic numbers N/M that are the *exact* WEAK-CONTESTED evidence class the document
   demoted to advisory in C25. Either the C25 reframing applies everywhere (then C33's floor is
   advisory) or it doesn't (then C25's whole argument is selective). As written it is a firm
   gate on folklore thresholds.

## Systemic blind spots across the set

- **The input-provenance gap (the deepest flaw).** Almost every "oracle" recomputes a verdict
  from an artifact the *same agent authored* — findings arrays (C1/C4), stated invariants
  (C13/C47), declared reads/writes (C32), agree-flags (C38), severity inputs (C9), rule sets
  (C15). Determinism over agent-chosen inputs is the document's own "garbage-in" caveat
  (Theme E) — but that caveat is applied only to C9 and silently ignored in a dozen other firm
  gates. **A verifier is only disjoint if its inputs are not agent-controlled.** Most of these
  are not. This is the single correction that should propagate across the table.

- **Infrastructure assumed, not built.** Five named scripts don't exist
  (`check-brief.sh`, `validate-skill.sh`, `route-state.ts`, `run-gates.sh`,
  `check-artifact-contracts.sh`), and — more fundamentally — **no per-target merge wiring
  exists.** Every "FIRM-GATE" is currently prose an agent may or may not honor; the firmness
  presupposes a `merge_group`-style enforcement layer (C2's own premise) that is unbuilt for
  every target. The roadmap conflates "logic is sound" with "gate is firm". They are not the
  same until wired.

- **Vacuity is under-defended.** The doc repeats "structure-green ≠ correct" as a slogan but
  several gates accept trivially-vacuous satisfiers: empty/`TODO` required sections (C6),
  `assert True`/never-failing properties (C5/C13/C47), `coverage>0` (C20), presence-only
  result objects (C27). Non-vacuity needs a uniform mechanism (mutant-kill requirement,
  filler-denylist) — currently it leans entirely on C16, whose anchors are the weakest.

- **Selective application of its own best idea.** C25's "deterministic ≠ valid; demote
  folklore thresholds" is the document's strongest, best-anchored move — yet count-floors
  (C7), auto-severity (C19), depth floors (C33), file caps (C36), and overlap thresholds (C46)
  smuggle the same magic-number pattern back into firm/computed gates. Apply C25 uniformly.

- **A few gates can block legitimate work** (false positives): C22 file-scope on generated
  paths, C43 hard question cap (conflicts with the diagnostic-interview rule), C45 snapshot
  flakiness, C30 absent-`gh` mis-inference. None are catastrophic, but each is a nag/blocker
  that erodes trust in the gate layer.

## What genuinely survives as a firm gate (SOUND, no reclassification)

Disjoint, recomputable, non-vacuous (modulo the input-provenance caveat), and cheap:
**C5** (RED/GREEN exit codes, *with* C16 non-vacuity), **C8** (citation existence + 0-hit grep),
**C11** (execution-proof capture), **C12** (deflake prerequisite, *with* append-only quarantine),
**C14** (de-escalation — correct refusal to over-claim), **C17** (dead-ref existence),
**C18** (weasel detection→triage), **C20** (trace presence; swap coverage>0 for passed-set),
**C21** (config type re-parse), **C23** (command existence probe), **C24** (jq counts),
**C25** (the central, well-anchored de-escalation), **C26**, **C28**, **C29** (artifact-presence floor),
**C31** (smoke proof), **C34** (force-on-only interview), **C35** (post-hoc contradiction),
**C36** (with cap-as-safety-bound framing), **C37**, **C40** (marker extraction), **C41**
(structured-field diff), **C42** (collision detection→report), **C44** (CHECK comparison).
**C2/C3** are sound in *logic* but inert until target CI wiring exists — firm-pending-infra.
