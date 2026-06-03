# Adversarial Review — Roster Evaluation Methodology

*Adversarial pass on `roster-evaluation-research-2026-05-31.md`. Goal: break the protocol on
FEASIBILITY and VALIDITY for a small/solo maintainer. Verdicts: SOUND / WEAKEN / RECLASSIFY / DROP.
Date 2026-05-31.*

## TL;DR of the attack

The research doc is internally honest about *statistical* threats (contamination, nondeterminism,
construct validity) and it correctly down-rates its own weak instruments (MI, DORA, self-report).
What it does **not** confront is the **operating-scale assumption**: every method it endorses is a
*lab* method (n≈30 seeds, ≥2 blinded raters with κ, held-out post-cutoff suites refreshed on a
schedule, component ablations per release). A solo maintainer cannot run any of these at the
prescribed power. So the protocol as written is not "rigorous vs sloppy" — it is **"unrun vs run."**
An unrun rigorous protocol has *lower* validity than a cheap honest one, because it ships nothing and
the maintainer falls back to the exact vibes it was meant to replace. The single biggest defect of
the doc is that it never states the budget, so it cannot notice it has specified something
unaffordable.

---

## Findings table

| # | Axis / claim | Attack (concrete) | Verdict | Fix |
|---|--------------|-------------------|---------|-----|
| 1 | **Cardinal: dev/holdout disjointness** (§4) for a *prompt* harness | The harness is tuned by hand-editing prompts/rules against a handful of failures. To improve, the maintainer *reads the holdout failures* — that is the only signal a prompt engineer has. Reading them = leaking them into the next prompt edit. The disjointness rule assumes a parameter-fitting loop that can be blinded; prompt engineering **cannot be blinded from its own error analysis**. So the split is violated structurally on the first iteration, not by accident. | **WEAKEN** | Keep a holdout, but redefine the rule: holdout is *look-once-per-release-then-burn*. After you read a holdout failure to fix it, that instance is permanently retired to the dev set and replaced. Track "holdout instances spent." Honesty = disclosing burn rate, not pretending you never looked. |
| 2 | **Holdout ages into training data** (§4 "refresh as it ages") | "Refresh the suite" is a recurring task with no owner and no budget. A solo maintainer builds a private post-cutoff suite *once*; within ~6–12 months the model versions roll and it is contaminated. The refresh cadence the doc assumes (continuous) costs more authoring effort than the eval itself. | **WEAKEN** | Stop trying to out-run contamination. Use *your own repo's* future commits as a rolling natural holdout: tasks dated after the pinned model's cutoff, drawn from real issues you'd have done anyway. Zero authoring overhead, intrinsically post-cutoff, and externally valid (it's literally your maintenance work). |
| 3 | **Holdout CI width** (§3.5, n≈30) | With a binary resolve metric and a *small* holdout (say 12 tasks), the 95% CI on a proportion is ±~28pp (Wilson). To detect a realistic harness lift of ~10pp at 80% power you need ~hundreds of *paired* tasks, or a much larger effect. A solo maintainer's holdout is small enough that **the CI swallows any plausible effect** — the rigorous interval honestly reports "indistinguishable from zero," which reads as "roster does nothing." | **RECLASSIFY** (capability holdout: from "proof" to "regression tripwire") | Don't power the holdout to *detect lift*; power it only to *catch regressions* (a one-sided guardrail: "did pass-rate drop below last release's lower CI bound?"). Lift claims move to per-task qualitative diffs, not aggregate CIs. |
| 4 | **§3.1 "Pin the model" isolates the harness** | Same weights ≠ same inference. Roster fans out multi-agent calls, injects different context, spends 5–20× the tokens of vanilla. You are not comparing "harness on a fixed substrate" — you are comparing *two different total inference procedures that happen to share weights*. The model is pinned; **the computation is not**. So "the only variable is the harness" is false: tokens, context window pressure, and call count all co-vary with the harness by construction. | **WEAKEN** | Drop the claim that pinning isolates the harness. Reframe: pinning removes the *weights* confound only. Report cost (§3.6) not as a footnote but as a **co-primary axis** — a harness that wins on resolve-rate while spending 10× is not "better," it's a different price point. Compare at *equal token budget* where possible (cap roster's spend), which is the only apples-to-apples cut. |
| 5 | **§3.2 ablation vs Cursor/Devin** | The doc's own §0 names Cursor/Devin as the motivating competitors. Both are **closed and bring their own model/scaffold** — you cannot run them on your pinned model. So the one controlled comparison people actually want is *impossible*, and what remains controllable (vanilla Claude Code, Aider, OpenHands — all open) are not the tools the value prop is pitched against. | **DROP** (the closed-tool controlled comparison) | Stop promising a controlled Cursor/Devin comparison; it cannot exist. Two honest fallbacks: (a) controlled comparison only against *open same-substrate* harnesses (Claude Code/Aider/OpenHands), clearly labeled "not Cursor"; (b) an *uncontrolled, disclosed* anecdote vs Cursor labeled as such. Never blend them. |
| 6 | **§3.5 n≈30 seeds × harnesses × tasks** | Cost reality: 30 seeds × ~20 tasks × ~3 harnesses = 1,800 agentic runs *per evaluation*, and roster runs are multi-agent (call it 200K–1M tokens each). That's order $10^3–10^4 in tokens **per release**, plus wall-clock. For a solo maintainer shipping monthly, this is the eval costing more than the product. Result: it is run **zero times** and the protocol is theater. | **WEAKEN** | Collapse the grid. n≈30 is for *stable population estimates*; a tripwire needs far less. Use ~5 seeds on ~8 tasks on *2* harnesses (roster vs one open baseline), paired, and accept wider intervals. Report it as "screening," not "estimate." The line between rigor and theater: rigor is *running a weak test honestly labeled weak*; theater is *specifying a strong test you never run*. |
| 7 | **§3.7 / §5 human rubric, ≥2 raters, κ** | (a) κ measures *agreement*, not *validity* — two raters trained on the same rubric reliably agree that verbose-but-clear code is "maintainable" while the construct is wrong; high κ can launder a bad rubric. (b) For a *solo* project there is **no second rater**. The maintainer is rater 1, rater 2, and the harness author — every blinding and independence assumption collapses. | **RECLASSIFY** (from "reliability via κ" to "self-blinded single-rater protocol") | Abandon κ for solo work (you cannot manufacture a second independent expert). Replace with **within-rater self-blinding**: strip provenance, shuffle, rate cold, and re-rate a 20% sample weeks later to get *intra*-rater consistency. For validity (not agreement) use a *behavioral* proxy instead of a rubric judgment — see #8. |
| 8 | **§5 follow-up-modification task** (time-to-modify + defect-injection) | This is the doc's best maintainability idea — but it is the *least* repeatable. Each run needs a fresh, realistic modification request the rater has not seen, executed under timing, with defect counting. Running it repeatedly across seeds × harnesses is days of human labor per release. Run it once and n=1; run it often and you've built a second full-time job. Also: the second time you modify "the same" code you've learned it — **practice confound** kills repeat measurement on the same artifact. | **WEAKEN** (keep as occasional, not per-release) | Demote to a *spot check* run a few times per *year*, on distinct artifacts to dodge the practice confound, reported as case studies with n stated. Do not gate releases on it. It is the strongest *validity* signal and the weakest *feasibility* signal — so use it rarely and honestly, never as CI. |
| 9 | **§5 / §3.7 friction: intervention / takeover rate** | "Lower intervention rate = less friction" is gameable and confounded. An agent that **asks fewer questions and barrels ahead** scores *better* on this metric while producing *worse* outcomes — it measures silence, not friction. Also fully confounded by task difficulty: easy task = few interventions regardless of harness. As a standalone number it can move the wrong way and look like progress. | **WEAKEN** | Never report intervention rate alone. Pair it with outcome (resolve + quality): friction only counts as *low* when intervention drops **and** outcome holds. Stratify by task difficulty or use paired same-task comparison so difficulty cancels. Treat a drop-in-asks-with-drop-in-quality as a *regression*, not a win. |
| 10 | **§5 METR cuts both ways** | The doc cites METR to say "never trust self-reported productivity." But METR's deeper lesson is corrosive to the *whole* protocol: even a careful RCT (16 pros, 246 tasks, real repos) was called *narrow / doesn't generalize*. If a real RCT can't generalize, a solo maintainer's 8-task screening **certainly** can't — so what can it legitimately *claim*? Risk: the methodology's own epistemics prove that nothing is claimable beyond "on these specific tasks, this specific week." | **SOUND (as a constraint), but forces a claim-scope rule the doc lacks** | Add an explicit **claims ledger**: the eval licenses only *local, dated, task-scoped* claims ("on my repo's May tasks, roster did not regress capability and reviewers preferred its diffs 7/8"). It does **not** license "roster is better." Honesty is in the *scope of the claim*, not the size of the n. This is the one place rigor and feasibility align. |
| 11 | **§2 DORA/SPACE for a solo dev** | DORA (deploy freq, lead time, MTTR) and SPACE (satisfaction survey) presuppose a *team* and a production deployment pipeline generating events. A solo maintainer has n=1 respondent (SPACE = a survey of yourself) and sparse deploy events. These instruments don't down-scale; they produce noise. | **DROP** (for solo scope) | Cut DORA/SPACE from the solo protocol entirely. They are team diagnostics. Keep only the single behavioral signal (intervention+outcome) and the qualitative diff review. |
| 12 | **§4 eval-as-CI gate** | "Gate releases on no significant regression" requires the eval to run on every release *and* be statistically powered to declare significance. Given #3 and #6, the gate either never fires (underpowered) or never runs (too expensive). A gate that can't reliably fire is **decorative governance**. | **WEAKEN** | Make the gate cheap and deterministic-ish: a tiny fixed smoke suite (3–5 tasks) at fixed seed, gating only on *hard* regressions (a task that used to pass now errors/crashes), not on statistical significance. Significance-grade evaluation is a manual, occasional event, not CI. |

---

## The feasibility cliff (prose)

The research doc has one unstated parameter that determines whether the entire protocol is real or
imaginary: **the evaluation budget per release.** Every recommendation is correct *in a lab* and
*unaffordable solo*, and the doc never multiplies the grid out, so it never sees the cliff.

Walk the multiplication. The "ideal" Axis A is: held-out suite × ≥10–30 seeds × ≥3 harnesses ×
paired design. Take a deliberately *modest* instantiation — 20 tasks, 10 seeds, 3 harnesses — and
you already have **600 agentic runs**. Roster runs are multi-agent: planner + implementer + reviewer
fan-out easily reaches mid-six-figure token counts per run. Six hundred such runs is a token bill
in the thousands of dollars and a wall-clock measured in days of babysat machine time — *per
evaluation*, and the doc wants this *per release plus per component ablation*. Then Axis B layers a
human on top: a blinded rubric across all those artifacts, plus a timed follow-up-modification task,
plus a *second rater* who does not exist on a solo project. The honest human-hour estimate for one
full Axis-B pass is on the order of *days* of focused expert labor, and it has to recur.

The cliff is not that any single step is impossible. It's that the protocol's validity *depends on
the conjunction* — disjoint holdout AND n≈30 AND ≥2 raters AND κ AND per-release cadence — and the
conjunction is what's unaffordable. A solo maintainer facing the full protocol does the rational
thing: runs none of it and ships on intuition. **That is strictly worse than running a small honest
test**, because the full protocol produced *zero* bits of evidence while feeling rigorous. This is
the precise failure mode the doc set out to prevent (vibes), re-introduced through the back door of
unaffordable rigor. **Specifying a test you will not run is itself a validity threat** — it is
theater that crowds out the cheap real thing.

Where is the line between rigor and theater? Rigor is *running a weak instrument and labeling its
weakness exactly* (8 tasks, 5 seeds, wide CIs, "screening only, local claim"). Theater is
*specifying a strong instrument you never execute* (30 seeds, two raters, κ) and then, when release
day comes, shipping on vibes while the methodology doc sits unused as a credential. The doc as
written is closer to the second. A solo maintainer needs the first.

One more cross-cutting point the doc half-makes: the **cost axis is not a normalization footnote,
it's a primary result.** Because pinning the model does not pin the inference (#4), the realistic
comparison is "roster spends 10× the tokens — is the quality delta worth 10×?" That is the actual
decision a maintainer faces, and it is *cheaper to measure* than statistical lift (you get tokens
free from the run logs). Cost-per-outcome may be the single highest-value, lowest-cost signal in the
whole protocol, and it sits at #6 in a list as if it were bookkeeping.

---

## Minimum-viable, actually-runnable protocol (solo)

Design target: total cost **≈ one focused day per release**, mostly machine time you don't babysit,
honest enough to beat vibes. Everything below is deliberately *under*-powered and *labeled* as such.

**MVP-1 — Regression tripwire (the floor; automatable).**
Fixed smoke suite of **5 tasks** drawn from your *own* repo's real issues, dated after the pinned
model's cutoff. **3 seeds** each, roster vs **one** open baseline (vanilla Claude Code *or* Aider —
pick one), paired on identical tasks. Gate only on **hard regression**: a task that passed last
release now errors/crashes/fails its own test. No significance math — a crash is a crash. This is
the only piece that runs *every* release. Cost: ~30 runs, an hour or two of machine time.
*Claim licensed:* "roster did not break these 5 tasks vs last release." Nothing more.

**MVP-2 — Cost-per-outcome (cheap, high value, free from logs).**
On the same 5×3 runs, record tokens + wall-clock per resolved task for each harness. Report the
ratio. This is the apples-to-apples cut that survives the pinning critique (#4) and it costs *zero
extra runs* — it's already in the logs. *Claim licensed:* "roster resolves these at N× the token
cost of baseline." This is often the decision-relevant number.

**MVP-3 — Self-blinded diff preference (the quality signal, ~1–2h).**
For each task where both harnesses produced a patch, strip provenance, shuffle order, and *cold-rate
your own outputs* on a 3-item rubric (correctness / minimality / would-I-merge). You are the only
rater — so drop κ (#7) and instead re-rate a random 20% a week later for **intra-rater consistency**;
disclose that number. *Claim licensed:* "blind-to-source, I preferred roster's diff on 7/8 tasks
(intra-rater consistency 90%)." A local, honest preference statement — not "roster is better."

**MVP-4 — Maintainability spot check (rare, not per-release).**
Once or twice a *year*, run the follow-up-modification task on a *fresh* artifact (new code, to dodge
the practice confound, #8): pick a real modification, time it, count defects, on roster-produced vs
baseline-produced code. Report as a dated case study with n stated. Never gate on it.

**Claims ledger (mandatory, ties to #10).**
Every number above licenses only a **local, dated, task-scoped** claim. The protocol can honestly
say "roster did not regress and I preferred its diffs on my May tasks at N× cost." It can *never* say
"roster is better than Cursor" — that comparison is uncontrollable (#5) and that generalization is
unlicensed by any feasible n (#10).

### What to DROP or DEFER from the ideal protocol

| Ideal-protocol item | Disposition (solo) | Why |
|---|---|---|
| n≈30 seeds, bootstrap CIs, McNemar, clustered SEs | **DROP** for routine use | Underpowered at solo holdout sizes anyway (#3); use 3–5 seeds as screening. |
| ≥2 blinded raters + κ/α | **DROP** | No second independent rater exists solo; replace with intra-rater consistency (#7). |
| Controlled comparison vs Cursor/Devin | **DROP** | Structurally impossible — closed, own substrate (#5). |
| DORA / SPACE | **DROP** | Team instruments; n=1 noise solo (#11). |
| Component ablation per release (reviewer off, planner off…) | **DEFER** | Multiplies the run grid; do *once* when introducing a major component, not per release. |
| Held-out post-cutoff suite + scheduled refresh | **REPLACE** | Use your repo's own future commits as a zero-authoring rolling natural holdout (#2). |
| Follow-up-modification task as CI | **DEFER to annual spot check** | Strongest validity, weakest feasibility; case-study cadence (#8). |
| Significance-gated release CI | **REPLACE with hard-regression tripwire** | Significance gate never fires or never runs (#12). |

### The smallest honest signal

If the maintainer will do **only one thing**, it is **MVP-1 + MVP-2 together**: a 5-task, 3-seed,
paired roster-vs-one-baseline run gated on hard regressions, reporting cost-per-outcome from the
logs. It is cheap enough to actually run every release, it directly answers the only universally
relevant question ("did I break anything, and what does this harness cost per result"), and it makes
**no claim it can't back**. It does not prove roster is *good* — nothing feasible does — but it
reliably catches roster getting *worse* or *more expensive*, which is the failure mode a solo
maintainer most needs an alarm for. That is the floor that honestly beats vibes.
