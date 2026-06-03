# Discriminator-Hunt Loop — State

**Goal:** find a problem complex enough that the three runners (`bare` / `plan` / `roster`)
**measurably diverge** — i.e., the harness demonstrably changes output quality. Rerun on
**Haiku** (the weak/cheap tier, most likely to be in the discriminating band).

## Why (evidence)
The `ledger-service` problem **ceilinged at both tiers**: every arm scored 100% at every stage,
invariant held, on Sonnet 4.6 AND Haiku 4.5. A benchmark where the bare model never fails cannot
measure a harness. See `runs-log` below.

## Discrimination criterion (when to declare success)
A problem **discriminates** if, holding model + seeds fixed, the arms differ on a deterministic
metric beyond noise:
- conformance pass-rate gap (an arm fails contract tests another passes), OR
- invariant: violated in ≥1 arm, held in another, OR
- cross-stage regression present in one arm, absent in another.
Confirm any candidate across **≥2 seeds** before declaring (single-seed = anecdote).
Cost/turns differences alone do NOT count as discrimination (they're confounded by wrapper
overhead) — only correctness/robustness gaps do.

## Difficulty ladder (escalate until discrimination, then stop)
1. ledger-service — DONE, ceilings at both tiers. ❌ no discrimination.
2. ticketing-v2 — interacting state machine (holds/confirm/cancel, idempotency, state
   transitions) + capacity-safety invariant under a **concurrent burst** (oversell race). Many
   interacting rules → a weak bare model is likelier to drop an edge case.
3. (if v2 ceilings) add stages / a harder feature: group all-or-nothing bookings, booking
   transfer between holders (atomic), waitlist promotion.
4. (if still ceilings) raise rule-count + concurrency further, or move to a fundamentally harder
   domain (mini in-memory SQL with txns, a CRDT, a scheduler with constraints).

## Mechanics
- Probe with a **single rich stage** first (cheap); expand to multi-stage only once a problem
  discriminates. Run Haiku, 3 arms; on a hit, add a 2nd seed to confirm.
- Each iteration appends to `runs-log` and updates the ladder.
- Stop when a problem discriminates across ≥2 seeds (report it), or when the user interrupts.

## MECHANISM FIX (iter1) — roster human-validation gate vs headless
The roster arm first run HALTED after 2 turns: it produced a plan + started asking the roster
human-validation QUIZ, then waited for input that never comes in headless `-p`. It wrote a docs/
plan but no server → scored 0/15 ("server did not start"). This is a HARNESS ARTIFACT, not a
roster code-quality result — roster is *designed* to stop for human approval, which is incompatible
with a fully-headless autonomous run (and is exactly why interactive/tmux matters for roster).
FIX: roster arm system prompt now states "running FULLY AUTONOMOUSLY, no human; do not pause for
validation/approval; proceed end-to-end." Re-ran roster after the fix. Lesson: bare/plan have no
such gate; only roster does. Any 0/N with tiny turn-count = check for the gate halt, do not score.

## runs-log
- iter0 ledger-service / Sonnet seed1: bare/plan/roster all S1-S4 perfect, inv ok. cum$ 0.853/0.840/0.987. ❌ no discrimination (ceiling).
- iter0 ledger-service / Haiku seed1: bare/plan/roster all S1-S4 perfect, inv ok. ❌ ceiling (even weak tier).
- iter1 ticketing-v2 / Haiku seed1: bare 15/15 inv✓ ($0.244,18t); plan 15/15 inv✓ ($0.173,9t); roster 15/15 inv✓ ($0.251,16t, after autonomous fix). ❌ CEILING — all three perfect. Concurrency-oversell lever did NOT bite: single-threaded Node sync handlers are atomic.
- iter2 reservations-v3 (interval-overlap, half-open boundary trap) / Haiku seed1: bare 16/16 inv✓ ($0.142,11t); plan 16/16 inv✓ ($0.086,6t); roster 16/16 inv✓ ($0.217,18t). ❌ CEILING — even the boundary trap didn't trip bare Haiku. Oracle was validated (closed-interval bug→caught), so this is a real ceiling, not a blind oracle.

## STRONG INTERIM CONCLUSION (after 3 problems, 2 tiers)
Ledger, ticketing, reservations — ALL ceiling: every arm 100%, invariant holds, at BOTH Sonnet
and Haiku. Clean, well-specified, self-contained, single-shot problems do NOT discriminate the
runners, because even the cheap model rarely fails them — so a harness has no failure to prevent.
A correctness-gap discriminator is unlikely to come from "a harder clean spec." The harness's
value, if real, must live in regimes this format can't capture cheaply:
  (A) UNDERSPECIFICATION — agent must infer/decide; planning surfaces ambiguity. (Scoring needs a
      hidden intended spec → risk of measuring spec-guessing, not quality.)
  (B) SCALE / long-horizon — many files, the bare model loses the thread; harness decomposition helps.
  (C) MAINTAINABILITY under cross-cutting change — many compounding stages where a late stage forces
      a refactor that breaks poorly-architected (bare) code → cross-stage regressions. (Original
      compounding hypothesis; our 4 additive stages were too easy/independent to trip it.)
  (D) genuinely hard ALGORITHMICS (txn snapshot-isolation, spreadsheet+cycles) — may discriminate,
      but risks flooring (all fail) or spec-ambiguity confounds.
DECISION POINT for rung 4: pick a direction (A/B/C/D) rather than keep guessing harder clean specs.
USER PICKED: mix of A(underspec)+B(scale)+C(compounding). NOT D(algorithmic).

- iter3 tracker-v4 (4 stages; scale + UNDERSPEC pagination S3 + BACKWARD-COMPAT cross-cutting
  refactor S4: idempotency-key + optimistic-concurrency versioning across create+status) / Haiku
  seed1: (running, stage by stage). Oracle validated: correct→22/22+inv✓; no-idempotency bug→caught
  (V.idempotent fails + burst creates 15). KEY SIGNALS: cross-stage regression at S4 (did the
  refactor break S1-S3?) + underspec pagination edges at S3 + idempotency-under-concurrency.
  RESULT: bare S1-S4 22/22 inv✓ (but flailed: S3 22t/$0.30, S4 26t/$0.28); plan 22/22 inv✓
  (efficient: ~15t). roster slow (still on S3 at log time). ❌ CEILING AGAIN — no correctness gap.
  Underspec didn't bite (bare inferred edges, just spent more turns); cross-cutting refactor did
  NOT break earlier contracts in any arm. Only signal remains COST/EFFORT (bare flails more), which
  is NOT discrimination per criterion.

## CONCLUSIVE NEGATIVE FINDING (4 problems, escalating, 2 tiers)
NO correctness discrimination found, ever. Clean/inferable, self-contained, single-process problems
with deterministic oracles do not separate bare/plan/roster — even cheap Haiku reaches correct on
all of them. The ONLY repeated signal is that bare sometimes uses more turns/cost to reach the same
answer (planning makes the PATH cheaper, not the OUTCOME better) — and cost is confounded, not a
valid discriminator. ⇒ The hunt for a "harder clean problem" is exhausted; a correctness-based
benchmark of self-contained problems structurally cannot show this harness's value.

## PIVOT — rung 5: patch a REAL, large, complex codebase (SWE-bench regime)
Where harnesses are known to help: comprehension + navigation + not breaking the untouched 99% of a
repo the model can't hold in context. Oracle = the repo's OWN test suite (held-out) + a task-specific
test that fails-before / passes-after. Arms get (repo + issue), produce a patch; score = hidden tests
pass AND existing suite still green. Needs: a real repo (deps installed at setup), a task with a
fail→pass test, a new score-patch runner (runs the repo's tests, not start.sh+HTTP). DECISION: pick
the codebase substrate before building (setup cost is real; a finicky pick wastes a lot).
- LESSON: Haiku one-shots self-contained, well-specified web CRUD + state machines + sync "concurrency". Need either (a) MANY compounding stages that punish bad early architecture, (b) trap-rich algorithmic correctness (transactions/snapshot-isolation, interval-overlap, rounding) where one-shot code reliably has a bug only tests catch, or (c) accept that small clean problems may be below the harness's value regime.
- NEXT (rung 3): escalate to a trap-rich, correctness-hard problem with a deterministic oracle.

## iter4 / rung 5 — REAL CODEBASE (miaou, OCaml, origin/main 64459ff)
Task: add `Chart_utils.normalize : float list -> float list` (precise API pinned; difficulty is
NAVIGATION of a 781-file dune repo + not breaking the suite, NOT API-guessing). Oracle = hidden
alcotest (fail-before/pass-after) + full `make test` green. Validated: baseline green; fail-before
{build:F,new:F,suite:F}; pass-after(reference) {build:T,new:T,suite:T}. Arms on Haiku
(bypassPermissions, opam env sourced; bare/plan .claude stripped, roster gets agent-roster .claude).
Score = score-patch.sh -> {build_ok,new_test_ok,suite_ok}.
RESULT: bare/plan/roster ALL {build:T,new:T,suite:T}, cheap (7-11t, ~$0.06-0.08). ❌ CEILING.
LESSON: pinning the exact file+API removed the NAVIGATION difficulty → became "edit 2 files," trivial
even in a 781-file repo. A real-codebase task only discriminates if the agent must LOCATE the change
itself (underspecified / non-localized), not be told where.

## OVERALL: 5 rungs, all ceiling. The discriminator requires REMOVING location/spec (navigation),
not adding algorithmic/scale difficulty to a well-specified localized task.
## rung 6 candidate: revert a REAL historical bug-fix commit in miaou (reintroduce the bug), give the
agent only the SYMPTOM (not the location), oracle = that fix's own regression test (behavior-defined,
no API pinned by us). True SWE-bench: locate+fix without being told where. Strongest remaining bet.

## iter5 / rung 6 — RAN: revert grid row_gap fix (8bff5cc) on miaou origin/main; `make test` red on
test_grid_layout row gap; arms must locate+fix in src. Scorer restores canonical test (anti-gaming),
requires full suite green. RESULT (Haiku): bare {build:T,suite:T} 11t/$0.17; plan {T,T} 12t/$0.18;
roster {T,T} 9t/$0.15. ❌ CEILING — all three located+fixed it. The failing-test name localized the
bug enough; one file, subtle \n fix; tractable for Haiku.

## FINAL CONCLUSION — loop STOPPED after 6 rungs (45 runs, ~$7.89 total)
NO correctness discrimination at any rung: ledger, ticketing, reservations, tracker (scale+underspec+
cross-cutting refactor), miaou feature (real repo), miaou bug-fix (real SWE-bench-style locate+fix);
Haiku AND Sonnet. The bare model succeeds at all of them; the harness changes the PATH (turns/cost),
never the OUTCOME. With a capable model, a harness's value does not surface as CORRECTNESS on tasks
that (a) have a clear deterministic oracle and (b) are tractable in scope or localized by a failing
test. The regimes where a harness likely DOES change outcomes — very large/vague scope with no
localizing signal, multi-file cross-cutting changes with hidden interactions, tasks beyond single-shot
capability — are exactly the ones a cheap deterministic oracle cannot capture. Corroborates the
methodology's prior caveat. RECOMMENDATION: write up the negative finding; stop hunting clean oracles.

## rung 7 — miaou-feat (OCaml, test-net thinned): add F1-F12 to Input_parser
Removed test_input_parser.ml (531-line suite) from the agent repo; asked for F-key parsing (pinned
API + xterm sequences); restored the removed test as a HIDDEN regression oracle at scoring + a feature
test. Fail-before {build:F,...}. RESULT (Haiku): bare {build:T,fkeys:T,regression_ok:T,suite:T} 22t/$0.22;
plan {all T} 30t/$0.29; roster {all T} 45t/$0.46. ❌ CEILING — all added F-keys AND preserved
Home/PageUp with NO tests present.
## KEY INSIGHT (user): OCaml's type system IS the net. Adding `Function` forces every exhaustive
match (key_to_string, is_nav_key, dispatch) to handle it or the BUILD fails — so removing tests
removes almost nothing; the only residual is purely-behavioral, type-checking bugs (ESC[15~ vs
ESC[1~ overlap), which a competent model avoids. A strong type system is a deterministic gate that
subsumes most test-net regression-prevention. ⇒ To test the harness's regression-prevention value via
test-removal, need a DYNAMICALLY-TYPED substrate.
## rung 8 (in progress): PYTHON. sqlparse (pure, coupled tokenizer/grammar, mature pytest suite).
Plan: thin tests on a complex module, ask a big related feature, restore removed tests as hidden
regression oracle. No compiler net → careless feature can break adjacent parsing silently.

## rung 8 — mistune (PYTHON, no compiler net): thin net + ==mark== feature
HEAD green (966). Removed tests/test_syntax.py (CommonMark conformance) to thin the inline net.
Asked: add ==mark== to the CORE inline parser (coupled regex dispatch; a bad == rule breaks
emphasis/escaping). Restored test_syntax.py as regression oracle + feature test. Fail-before
{feature:F,regression:T,suite:F}. RESULT (Haiku): bare {feature:T,regression:T,suite:T} 44t/$0.476;
plan {all T} 28t/$0.340; roster {all T} 43t/$0.472. ❌ CEILING — all added the feature AND kept
CommonMark conformance green. Caveat: test_commonmark.py remained (partial net); and the model's own
knowledge of Markdown is itself a net.

## FINAL (8 rungs, 51 runs, ~$10.15): NO correctness discrimination, anywhere.
toy(ledger/ticketing/reservations) · multi-stage(tracker: scale+underspec+cross-cutting) · real
OCaml feature · real OCaml bug-fix · OCaml test-net-thinned · Python test-net-thinned. Haiku & Sonnet.
bare ALWAYS reached correct (sometimes 1.3-2x the turns/cost). Two nets make the harness's
regression-prevention redundant: (1) a strong TYPE SYSTEM (OCaml), (2) the MODEL'S OWN KNOWLEDGE +
ability to iterate against any remaining signal (both langs). The only consistent difference is
COST/EFFORT (bare thrashes more), which is confounded and not a correctness gap. CONCLUSION: a
correctness-oracle benchmark cannot demonstrate this harness's value; its value (if any) is in
PATH-efficiency and in regimes a cheap deterministic oracle can't capture (large/vague/long-horizon,
genuinely beyond single-shot capability, or quality/maintainability not reducible to pass/fail).

## *** BREAKTHROUGH (rung 9 method): adversarial edge-probing finds discrimination ***
Method (user's design): instead of guessing a task where bare fails, MINE bugs from bare's actual
output via adversarial edge-probing, ground-truth them, then test all arms.
Target: the mistune ==mark== outputs (already produced). Ran a 30-case edge battery (nested,
whitespace, escaping, adjacency) through bare/plan/roster's actual implementations; found 3 inputs
that DIVERGE — and on all 3, bare differs from plan+roster (which agree).
  - "== =="          bare <mark> </mark>   | plan/roster literal  (CORRECT per official mark plugin)
  - "==  spaced  =="  bare marks it         | plan/roster literal  (CORRECT)
  - "==x ==y=="       bare closes at space  | plan/roster close at end (CORRECT)
Ground truth = mistune's official `mark` plugin: matches plan/roster exactly. bare ignores the
whitespace-FLANKING rules emphasis uses. Encoded as 3 bug-tests:
  bare 3 FAILED · plan 3 passed · roster 3 passed.  <<< FIRST REAL DISCRIMINATION (8 rungs of ceiling)
SIGNIFICANCE: the happy-path acceptance oracle passed all arms; discrimination was invisible to it
and appeared ONLY under adversarial edge-probing (the generation-verification gap). Reframes the
whole negative result: the harness's value is in correctness DEPTH (edge robustness), not breadth —
which is exactly what a happy-path deterministic oracle cannot see. ⇒ The right way to evaluate
roster is ADVERSARIAL DIFFERENTIAL testing (edge battery vs ground truth across arms), not pass/fail
acceptance suites.
CAVEATS: n=1 (one task/seed); separates {plan,roster} from bare, NOT roster from plan (both correct
here); needs replication across seeds/tasks to be robust.

## CORRECTION (integrity): roster's tracker-v4 arm was INCOMPLETE
Verified from result files: roster tracker recorded only S1(4/4) + S2(11/11); S3/S4 never recorded.
roster's tracker code has NO version/idempotency (S4 features) — confirming S4 never ran (roster was
"still on S3" when bare/plan S4 launched, and I moved on). So earlier "tracker — all arms ceiling"
OVERSTATED roster: bare/plan S4=22/22 stand, roster's tracker S4 did not complete. The plan-vs-roster
tracker probe was therefore INVALID (complete-plan vs incomplete-roster). Re-running roster tracker S4
to enable a fair plan-vs-roster comparison.

## plan-vs-roster hunt (in progress): NO valid discrimination yet.
mistune (only task complete for all 3 arms): plan == roster EXACTLY (both 2/58 vs ground truth, same
2 misses; bare 11/58). Roster's pipeline added nothing plan-first didn't already get there.

## *** ACTIONABLE multi-seed result (mistune ==mark==, 4 seeds x 3 arms) ***
Edge-bugs vs ground truth (official mark plugin), out of 58 cases:
  seed1: bare 11, plan 2, roster 2
  seed2: bare  2, plan 2, roster 2
  seed3: bare  5, plan 2, roster 2
  seed4: bare  2, plan 2, roster 2
1) plan == roster IDENTICALLY on all 4 seeds (same mismatch set). NO plan-vs-roster discrimination;
   roster's pipeline adds nothing over plan-first on this task.
2) bare-vs-disciplined gap is VARIANCE, not mean: bare ties (2) on 2 seeds, is far worse (5,11) on
   2 seeds; plan/roster are steady at 2 every seed. The harness's value = eliminating the buggy TAIL,
   not improving the median. Single-seed would have missed this.
Shared floor of 2 (all disciplined): raw HTML not escaped inside ==mark==. bare's extra bugs:
whitespace-flanking delimiter rules.

## *** ACTIONABLE plan-vs-roster DISCRIMINATION (interleaved/split task) ***
User idea: split the change into steps with UNRELATED work in the middle (3-step: add ==mark== →
add docstrings [unrelated] → make ==mark== round-trip), run multi-seed × arms, probe ==mark== edge
battery. RESULT (interleaved, edge-bugs/58):
  seed1: bare 2, plan 2, roster 2
  seed2: bare 2, plan 2, roster 2
  seed3: bare 5, plan 40, roster 2   <<< PLAN BROKE THE FEATURE, roster fine
VERIFIED plan seed3 is a real bug: mistune.html("==hi==") -> "<p>==hi==</p>" (no <mark>); feature_ok
=FALSE; inline_parser.py mark-rule count identical to base => plan NEVER wired ==mark== into the core
parser. Distracted by the interleaved docstring/round-trip steps, plan-first DROPPED the core feature.
roster (same seed, same interleaving) implemented it correctly (2/58).
SIGNIFICANCE: focused task -> plan==roster (no gap). INTERLEAVED task -> plan loses the thread on
1/3 seeds; roster's pipeline (review/QA) holds. Neither had the acceptance test (thinned net), so this
measures the harness's INTERNAL discipline. ⇒ roster's value is in COMPLETENESS under multi-step /
context-switching / long-horizon tasks, NOT in focused single-shot (where plan-first suffices).
CAVEAT: 1/3 seeds (rate needs more seeds); it's a completeness failure (feature not finished), even
more striking than an edge bug. This is the first verified plan-vs-roster actionable sample.

## !!! RETRACTION of the "plan-vs-roster discrimination" above — it was an ARTIFACT !!!
On user's probing ("how is it breaking the plan?") I read plan seed3's transcript: it made ZERO
source changes and its final message was "The plan is ready... Shall I proceed with implementation?"
=> plan-mode arm HALTED at an approval gate (headless, no human) and never implemented. Same bug
class as roster's earlier human-validation gate. AND the asymmetry was MINE: the roster arm prompt
had a "FULLY AUTONOMOUS, do not pause for approval" clause (added after the roster-gate incident),
but the PLAN arm prompt did NOT. So roster "won" seed3 only because I'd hardened roster against the
approval-halt and not plan — a harness-setup asymmetry, not a capability difference. The "interleaving
breaks plan" claim is WITHDRAWN pending a fair re-test.
FAIR RE-TEST (in progress): added the same autonomy clause to the plan arm; re-running plan on the 3
interleaved seeds. If plan now implements correctly (~2 edge-bugs like roster), the discrimination was
purely the approval-halt artifact. If plan still drops the feature under interleaving, the effect is real.
LESSON: always read the transcript before declaring discrimination; equalize arm prompts (the approval
clause must be identical across arms or it confounds everything).

## FAIR RE-TEST RESULT (prompts equalized) — plan-vs-roster CLEARLY ABSENT
Interleaved ==mark== with the autonomy clause added to the PLAN arm (so neither arm halts for
approval), clean probe after all jobs finished:
  plan seed1=2, seed2=2, seed3=2 (all feature_ok=true) == roster (2,2,2).
=> The "interleaving breaks plan (40 vs 2)" result was 100% the approval-halt artifact from an
asymmetric prompt. Equalized, plan ≡ roster on focused AND interleaved tasks.

## FINAL, HONEST CONCLUSION of the whole hunt
- NO plan-vs-roster discrimination exists on any task/regime tested (focused or interleaved,
  multi-seed). roster's multi-agent pipeline adds NOTHING measurable over a simple "plan-first" prompt.
- The ONLY real, validated signal is bare-vs-disciplined, and it is VARIANCE/tail-risk: bare ties the
  disciplined arms ~half the seeds and ships 2.5-5x more edge-bugs the other half; plan/roster steady.
- Two artifacts caught (both = asymmetric/halting harness setup): roster human-validation gate; plan
  approval-halt. LESSON: arm prompts MUST be identical except the harness under test; READ TRANSCRIPTS
  before declaring; multi-seed + adversarial edge-probe vs ground truth is the only protocol that saw
  anything real.
