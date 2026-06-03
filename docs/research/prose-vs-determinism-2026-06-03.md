# Prose-as-Code vs. Determinism in Roster — A Substrate-Level Research Report

*Researched 2026-06-03. Builds on the prior determinism program (the C1–C47 / W0
work in `docs/research/determinism-*-2026-05-31.md` on `wip/benchmarks`). That program
asks **"how do we trust a verdict?"** — replacing agent self-judgment with sound,
disjoint external verifiers (exit codes, SARIF, CI-as-oracle). **This report asks the
adjacent, earlier question: "how do we trust the prose that produces the verdict in the
first place?"** The substrate under every gate is markdown an LLM authored and re-edits;
the gates run, but the logic they enforce lives in a drift-prone medium. The prior work
hardens the *output side* (verdicts). This report is about the *input side* (the skill
and recruiter prose itself, and the executable logic embedded in it).*

---

## 1. The Tension, Grounded in Roster's Code

Roster's stated identity is **"fast and correct"**, and the prior research program names
its goal as replacing *self-judgment* with a **sound external verifier** wherever one can
exist. But roster's load-bearing logic does not live in code — it lives in markdown that
an LLM reads, regenerates, and re-edits. The framework then runs guard scripts that diff
that prose back out to detect drift. This is a real, working pattern. It is also a patch
over a fragile substrate rather than a removal of the fragility. Five concrete loci:

### 1.1 The pipeline state machine is a jq predicate duplicated across two markdown files

The single sharpest example. The valid mode→phase sequences and the valid per-phase
outcome vocabulary — the roster *control-flow contract* — are encoded as a jq predicate,
`LEDGER_SCHEMA`, embedded as a shell heredoc **inside skill bodies**:

- `skills/pipeline/roster-run.md:133` (resume logic)
- `skills/pipeline/roster-doctor.md:148` (status logic)

The predicate hard-codes the state machine in prose:

```
{express:["implement","review","ship"],
 fast:["implement","review","qa","ship"],
 full:["question","research","intake","spec","plan","implement","review","qa","ship"]} as $seq
| {intake:["VALIDATED"],spec:["VALIDATED","SKIPPED","BOUNCED"],
   review:["GO","NO-GO"],qa:["GO","NO-GO"],ship:["COMPLETED"], ...} as $vocab
```

`roster-doctor.md:147` carries the comment: *"LEDGER_SCHEMA is the SAME predicate as
roster-run Step 1.4 — keep the two copies …"*. The two copies are kept honest by
`scripts/check-pipeline-install.js` Check 4, whose own header states the invariant: the
predicate must be **"byte-identical in roster-run (resume) and roster-doctor (status) — so
the two never disagree on which ledgers are valid."** This is real source code — a state
machine — that has been copy-pasted into two prose documents and is held in sync by a
byte-diff. Any LLM that regenerates either skill can silently desync the resume logic from
the status logic; the guard is the only thing that catches it.

### 1.2 The recruiter is 1005 lines of prose carrying install commands, jq, and a registry list

`recruiter/recruiter.md` (1005 lines) and its canonical twin `.harness/agents/recruiter.md`
must be **byte-identical** (enforced by `scripts/check-recruiter-sync.js`). The header of
that guard documents the exact failure it exists to prevent: *"this is exactly how the
v2.5.2 auto-update feature got dropped from the Codex projection."* A feature was lost
because prose drifted between two source copies and a projection. The recruiter prose
embeds: the install one-liner (`curl … install.sh | bash`), references to the external
registries (`VoltAgent/awesome-claude-code-subagents`, `wshobson/agents`, … — the authoritative
enumerated list lives in `README.md`), version-comparison logic, and a "Skills to install" list
that **must exactly match the skills on disk** —
also guarded by `check-pipeline-install.js` Check 1 ("no skill that exists would be
skipped … no listed path is missing on disk").

### 1.3 Hooks are shell scripts living inside markdown, extracted by awk

Per `schema/hook-schema.md`, a tool-level hook's actual executable body is a fenced
` ```command ` block inside a markdown file. `sync-harness.sh:398` (`extract_command_block`)
awk-scrapes that block out and `build_hooks_json` (line 407) jq-assembles it into
`.claude/settings.local.json`. Skill hooks are worse: their control flow (`steps:`,
`loop:`, `goto:`, `test:/on_true:/on_false:`) is a **YAML mini-DSL inside markdown,
interpreted by the LLM itself at runtime** (`schema/hook-schema.md:175`+) — the schema
explicitly notes `timeout:` is "advisory ms — LLM best-effort, not enforced" and
non-reentrance is "enforced by prose instruction in `roster-run.md` — not by a process
mechanism." The control flow is prose the model is *trusted to interpret correctly*.

### 1.4 The projection model itself: source prose → many surfaces, drift-checked

`sync-harness.sh` projects `.harness/` into Claude (`.claude/commands/`), Codex
(`.codex/agents/*.toml` + `.agents/skills/*/SKILL.md`), OpenCode, and Copilot surfaces.
The TOML projection (`sync_agents_to_codex_toml:556`) wraps an entire markdown agent body
in a TOML triple-quoted string with hand-rolled `sed` escaping. `sync-harness.sh --check`
(line 58) regenerates every projection into a sandbox and `diff -rq`s it against the
committed tree, failing on drift. The script's own comment concedes the limitation:
detection is **one-directional** (generated→real) and "does NOT" catch files that should
have been *removed*. So the drift guard is itself incomplete by construction.

### 1.5 Schema rules are prose conventions, not enforced types

`schema/skill-schema.md` defines required frontmatter and sections as **prose requirements**.
`check-skill-structure.ts` lints the presence of a subset (`## Steps`, `## When to Go Back`,
`## What Next`, and `## Friction Log` when `friction_log: true`) — not the full schema-doc list
(Input/Output Contract, Rules), and never the section *content*. But as the prior research's §7 keep-agentic
boundary states repeatedly: *"a schema-green or lint-green artifact must never be read as
'correct'"* — structure-present ≠ semantically-valid.

**The pattern.** In every case the load-bearing artifact is prose; the safeguard is a
*detector* (`check-*.js`, `--check`) that notices after the fact when the prose has gone
out of sync. The prior session's own G1 position names this exactly: *"Prose conventions
rot silently (observed this session: human-validation trap-wording drift; the recruiter
feature dropped from a projection). Recomputed verdicts + kept-updated CI do not."* That
observation is the seed of this report. The question is whether the **byte-diff-the-prose**
approach is the right long-term answer, or a stopgap.

---

## 2. What's Irreducible vs. What's Accidental Fragility

Not all of roster's prose is the same kind of thing. Separating the two is the whole game.

### 2.1 Genuinely irreducible — must stay prose, must stay LLM-interpreted

These are *instructions to a reasoning agent*. There is no typed core to extract because
the "execution" is judgment, and the literature is firm that judgment is exactly what you
must **not** mechanize:

- **Adversarial review reasoning, severity calls, root-cause synthesis, "what vs how" mode
  selection** — the prior research §7 ("Keep-Agentic") enumerates these. Mechanizing them
  manufactures false confidence.
- **Skill *workflow narrative*** — "interview the user adversarially", "find ≥1 challenge
  per story", "be blind to the task" (roster-research). This is genuinely a prompt; its
  value *is* its prose form. Constrained decoding and codegen do nothing here.
- **The trigger `description` frontmatter** — `skill-schema.md` is explicit that a
  description is a *trigger*, and triggering is a soft, model-side match.

For this class, the substrate is correct. The improvement opportunity is not to remove
prose but to **eval it** (golden tests, §3.3), not type it.

### 2.2 Accidental fragility — logic that is in prose but should not be

This is the addressable surface, and it is larger than it looks:

- **`LEDGER_SCHEMA`** (§1.1) is a finite-state-machine definition. It is *data*: a map of
  modes to phase-lists and phases to outcome-vocabularies. There is no reason for it to be
  prose, let alone *duplicated* prose. This is pure accidental fragility.
- **The recruiter's "Skills to install" list** (§1.2) is a manifest. It is already
  *derivable from disk* — that is precisely what `check-pipeline-install.js` Check 1
  recomputes. The check proves the list is redundant: anything you can diff against the
  filesystem, you can *generate* from the filesystem.
- **The recruiter↔canonical byte-identity requirement** (§1.2) is the worst kind:
  two hand-maintained copies of the same 1005 lines. The "single source of truth" exists
  in name (`.harness/` is canonical) but is violated in fact (`recruiter/recruiter.md` is a
  second authored copy that install.sh hardcodes). This is a duplication that should be a
  build step.
- **Hook command bodies** (§1.3) are shell scripts. A shell script in a `.sh` file under
  test is strictly more robust than the same script awk-scraped out of a fenced block.
- **The jq predicates in `sync-harness.sh`** that assemble hooks/TOML are real code already
  — but they parse prose to do it, so they inherit the prose's fragility.

**The dividing test:** *if a guard script can recompute the artifact's **value**
deterministically, that value is data or code, not prose — and it should live as data or code
that the prose merely references.* The checks that **recompute a value** are the signposts to
accidental fragility — Check 4 recomputes the FSM (`LEDGER_SCHEMA`), Check 1 recomputes the
install list from the filesystem; the existence of such a check proves the thing it checks is
mechanically derivable and didn't need to be authored prose. This is distinct from checks that
merely verify a **property of** genuine prose — `check-kb-links.js` (do KB links resolve?) and the
structure linters (`check-skill-structure.ts`, `check-agents.ts`, `check-hook-structure.ts`, which
assert section *presence*, not derivable content). Those guard real prose and have nothing to
extract; only the recompute-the-value class is a signpost. This is the "thin prose over a typed
core" pattern, and the broader field has converged on it: the *Blueprint First, Model
Second* paper (arXiv:2508.02721) codifies the operational procedure into a "source
code-based Execution Blueprint … executed by a deterministic engine," with the LLM invoked
only "to handle bounded, complex sub-tasks … but never to decide the workflow's path."
Roster's `LEDGER_SCHEMA` is exactly a workflow path encoded the wrong way round.

### 2.3 The honest counter: codegen moves drift, it doesn't always remove it

A generated artifact has its own failure mode. The Rush/codegen practice literature is
blunt: "drift occurs" when generated files aren't checked in or rebuilt, and the standard
answer is *"PR builds can run checks that require any drift to be corrected before a PR can
merge"* — i.e. you trade authored-prose drift for **generated-artifact drift**, policed by
exactly the same `--check`-in-CI mechanism roster already uses. And the deeper warning from
the AI-codegen drift discussion: if *code becomes the source of truth*, humans must read
the generated output to understand intent, which is "slow and unreliable." So generation is
not free. **It relocates the trust boundary** from "is the prose correct?" to "is the
source-of-truth spec correct, and is the generator correct?" That can be a strictly better
trade (the spec is smaller and typed; the generator is tested once) — but only when the
generated surface is large relative to the spec. For a one-line `description`, codegen is
pure overhead. This is why the recommendation (§4) is staged by *leverage*, not all-or-nothing.

---

## 3. Concrete Alternatives for Roster

Each: what it is · what it changes in roster specifically · cost · drift removed vs. left ·
verdict.

### Alternative A — Extract embedded logic into typed data/code that prose references

**What it is.** The "thin prose over typed core" pattern. Pull the load-bearing
non-prose out of markdown into a real artifact (a JSON/TS module), and have both the prose
*and* the runtime reference the single artifact instead of re-stating it. This is the
core move in *Blueprint First, Model Second* (arXiv:2508.02721) and the *Compiled AI*
line (arXiv:2604.05150): "generating correct business logic benefits from LLM reasoning,
but executing that logic … does not."

**What it changes in roster.**
- `LEDGER_SCHEMA` → a single `schema/pipeline-fsm.json` (the mode→phase and
  phase→outcome maps). `roster-run` and `roster-doctor` each `jq -f` *the same file*
  instead of embedding a heredoc twice. `check-pipeline-install.js` Check 4 (byte-identity
  of two prose copies) is **deleted** — there is now one copy, so it cannot desync.
- The recruiter "Skills to install" list → *generated* from `skills/` at projection time
  (or simply read from disk at runtime). `check-pipeline-install.js` Check 1 becomes
  unnecessary.
- Hook `command` blocks → real files under `.harness/hooks/<name>/command.sh`, referenced
  by the hook md, `chmod +x`, and unit-testable with `.bats` (the schema already mentions
  bats). `sync-harness.sh`'s awk-scrape (`extract_command_block`) goes away.

**Cost.** Medium. Touches `sync-harness.sh`, two pipeline skills, the recruiter, two guard
scripts. Mechanical, not conceptual. No new dependency.

**Drift removed.** The most dangerous, highest-leverage drift in the framework:
duplicated state-machine logic, the recruiter double-copy, scraped shell. **Drift left.**
The workflow *narrative* prose (correctly — §2.1). Introduces one new (smaller) surface:
the generator step in `sync-harness.sh` must stay correct — but it is tested once and
shared, vs. re-verified on every LLM edit.

**Verdict. Do this first.** It is the highest ratio of fragility-removed to cost, it
*deletes* guard scripts rather than adding them (net-negative friction, satisfying the
prior research's G1), and it does not touch the irreducible prose. It is the cleanest
expression of "every `check-*` invariant is a signpost to logic that shouldn't be prose."

### Alternative B — Spec-as-source / codegen: author skills from a typed source, not markdown directly

**What it is.** Make `.harness/*.md` themselves *generated* from a typed source (TS/JSON
schema objects with `description`, `phase`, `tunables`, `artifacts`, body fragments),
rather than hand-authored markdown. The field calls this *prompt-as-code* /
spec-driven: "establish a single source of truth … the prompt text, the schema, the
config, and the evaluation criteria." Spec-Driven Development (the 2026 SDD guides)
makes "an executable, version-controlled specification — not the code — the single source
of truth."

**What it changes in roster.** A new authoring layer above `.harness/`. The frontmatter
becomes typed fields (compile-time-checked: `phase` is an enum, `artifacts.reads` is a
path-glob type), and `sync-harness.sh` extends to render from it. The schema docs
(`schema/skill-schema.md`) become *executable types* instead of prose conventions;
`check-skill-structure.ts` is replaced by the type-check.

**Cost.** High. This is a second projection layer on top of the one roster already has —
roster currently projects `.harness → runtimes`; this adds `typed-source → .harness`.
Real risk of the AI-codegen trap (§2.3): humans now read generated `.harness/*.md` to
understand a skill.

**Drift removed.** Frontmatter/structure drift entirely (it's typed). **Drift left.** The
body prose is still prose; you've typed the envelope, not the letter. And you've **moved**
drift from "prose vs. schema-doc" to "generated `.harness` vs. typed source" — net win only
if the typed surface is large.

**Verdict. Defer / partial.** Over-engineered as a whole. The *valuable subset* — typing
the **frontmatter** (not the body) — is real and cheap and overlaps with Alternative A.
Adopt the frontmatter-typing slice; reject the full body-codegen layer until there is
evidence the structure drift is actually biting (it currently is not — the biting drift is
*logic* drift, §1.1/§1.2, which A fixes directly).

### Alternative C — Golden / snapshot eval harness for the prose (promptfoo in CI)

**What it is.** Treat the irreducible prose (§2.1) the way you treat code you can't prove
correct: pin its *behavior* with golden tests and gate CI on them. promptfoo is the de-facto
tool — "declarative configs, batch testing, regression checks … CI/CD integration," "used
by OpenAI and Anthropic." A golden suite has "happy paths, edge cases, adversarial cases";
PR runs are "a regression gate," nightly runs "a quality trendline."

**What it changes in roster.** A `evals/` dir with fixtures: e.g. given a task, does
`roster-run`'s classifier pick the right Express/Fast/Full mode? Does `roster-research` stay
blind (the prior C46 "blindness overlap" check, but as an eval, not a hard gate)? A
promptfoo config + a `roster-evals.yml` CI workflow. This is the *behavioral* complement to
A's *structural* fix: A stops the FSM from desyncing; C catches a skill *body* edit that
silently changes classifier behavior.

**Cost.** Medium-high, and ongoing (golden suites are maintenance; the prior research flags
snapshots as "a classic flakiness source," cf. C45). Needs a model budget in CI.

**Drift removed.** *Behavioral* drift in prose that no structural check can see — the class
A and B cannot touch. **Drift left.** Nothing structural (that's A/B's job); and golden
tests pin *observed* behavior, not *correct* behavior (the prior research's Theme D / C14
caution applies directly: a green generated/snapshot suite asserts "behavior unchanged,"
not "correct").

**Verdict. Adopt, scoped, as a fast-follow to A.** This is the *only* alternative that
addresses the genuinely-irreducible prose, so it is not optional long-term. But born
advisory (per the prior research's G3 "promote firm ← advisory only on measured precision")
— a flaky LLM-judge eval must never hard-block a legitimate skill edit.

### Alternative D — Structured / constrained generation for the artifacts skills *emit*

**What it is.** Where a skill emits a machine-consumed artifact (the review GO/NO-GO JSON
verdict, the friction `.jsonl`, the state ledger), constrain that emission to a JSON schema
via the runtime's structured-output mode rather than asking the model to hand-write JSON in
prose. Constrained decoding "guarantees constraint compliance" and is often *faster* than
free generation (XGrammar: <40µs/token).

**What it changes in roster.** The `roster-review` verdict, `briefs/*-state.json`, and
`friction.jsonl` emissions move to schema-constrained tool calls. Malformed-JSON failures
(a real class for hand-written JSON) vanish.

**Cost.** Low-medium, but **runtime-coupled** — and this is the catch for roster
specifically. Roster is *multi-runtime* (Claude, Codex, OpenCode, Copilot). Anthropic's
strict mode "rejects more of the JSON Schema spec than OpenAI's: no recursive schemas, no
min/max, no $ref … 20 strict tools per request"; behavior differs per runtime. Roster's
whole projection model exists to stay runtime-neutral; constrained decoding is the opposite.

**Drift removed.** *Shape* drift in emitted artifacts. **Drift left.** The crucial caveat
from the structured-output literature: *"Structured outputs improve reliability of form, not
correctness of meaning"* — "the remaining failures are semantic: incorrect extracted values
that still fit the schema." This is the prior research's disjointness point restated:
schema-valid ≠ honest. It does nothing for the §1.1/§1.2 *authoring* drift.

**Verdict. Adopt narrowly, runtime-permitting.** Good for the emit side (cheap win on
malformed JSON), useless for the substrate problem this report is about. Keep it
capability-detected (the prior research's W0 pattern), never assume it.

### Alternative E — Declarative skill DSL compiled to runtime surfaces (DSPy-style)

**What it is.** Replace hand-tuned prompt prose with typed *signatures* + *modules* that a
compiler turns into prompts (DSPy: "programming — not prompting"; "each compilation
produces a deterministic artifact tied to a specific model, dataset, optimizer"). The
selling point against roster's exact pain: "shared prompt strings … drift as different
people tune … Shared Signatures and Modules create a contract."

**What it changes in roster.** Radical: skill bodies cease to be authored markdown and
become DSPy programs; "skills" become compiled artifacts per target model. Roster's
`skills/*.md` substrate is replaced wholesale.

**Cost.** Very high, and a paradigm change. DSPy optimizes against a *metric on training
data* — roster has no such labeled dataset, and the prior research (C39) already warns a
small hand-labeled fixture is "noisy + overfit." DSPy compilation is also tied to a specific
model; roster is deliberately multi-model/multi-runtime. The compiled prompts are *opaque*
— the antithesis of roster's human-readable, human-validated skills (the human-validation
protocol depends on a human being able to *read* the plan/skill).

**Drift removed.** Manual prompt-tuning drift, in principle. **Drift left / introduced.**
Replaces readable prose with opaque compiled artifacts and a training-data dependency
roster doesn't have; the drift moves into "is the optimizer's metric right?"

**Verdict. Reject for roster.** Right idea (prompts-as-contracts), wrong fit. Roster's
core value proposition — human reads and validates the skill — is incompatible with opaque
compiled prompts, and the multi-runtime + no-labeled-data constraints make DSPy's
compilation model inapplicable. Borrow the *philosophy* (typed contracts at boundaries =
Alternatives A/B), not the tool.

### Alternative F — Move orchestration into a deterministic engine; keep skills as called sub-tasks

**What it is.** The strongest version of "thin prose over typed core": the *control flow
between* skills (the pipeline graph, routing, gating, resume) becomes a real state machine
in code (LangGraph-style: "agents as deterministic state machines rather than conversational
prompt pipelines"; OpenAI Agents SDK guardrails/handoffs; *Blueprint First* deterministic
engine), and each skill is a node the engine calls — prose only *inside* a node, never
*deciding the path*.

**What it changes in roster.** `roster-run`'s routing logic (currently 17KB of prose +
the embedded `LEDGER_SCHEMA`) becomes a small engine that owns mode-classification routing,
phase sequencing, gate checks, and resume — calling skill bodies as bounded steps. This is
`LEDGER_SCHEMA` taken to its conclusion: the FSM isn't just *extracted* (Alt A), it's
*executed by an engine* instead of interpreted by the LLM reading `roster-run.md`.

**Cost.** High, and architecturally load-bearing. It also **collides with roster's stated
platform constraint** (README: Claude Code / Codex offer only "bounded, single-level
subagent delegation … neither runtime offers unbounded recursive spawning"). A
LangGraph-style engine assumes an orchestrator process roster deliberately does *not* assume
— roster relays through "artifacts and human gates between sessions" precisely because it
can't run a long-lived orchestrator inside these runtimes. So a full engine is partly
fighting the platform.

**Drift removed.** *All* control-flow drift — the §1.1 class, permanently, because the FSM
is executed not interpreted. **Drift left.** In-node prose (correctly).

**Verdict. Aspirational; adopt the cheap half now.** The full engine fights the platform
constraint and is a large bet. But its *cheap half is identical to Alternative A*: extract
the FSM to data. The expensive half (a long-lived orchestrator executing it) waits for the
platform to allow it, or for the prior research's W0 (per-target CI/hooks) to provide the
deterministic runner — note W0's agent-runtime-hooks layer is already a partial
"deterministic engine the LLM can't bypass" (PreToolUse blocks). **F and the prior W0
converge**: W0 is where a deterministic execution layer can actually live today.

---

## 4. Recommendation — A Staged Path

Not all-or-nothing. The leverage is wildly uneven: the *logic* drift (§1.1/§1.2) is
cheap to kill and high-impact; the *prose-behavior* drift is expensive and ongoing; the
*paradigm* changes (DSPy, full engine) are bad fits for roster's multi-runtime,
human-readable, platform-constrained design.

**Stage 0 — Extract the load-bearing logic out of prose (Alternative A). Do now.**
- `LEDGER_SCHEMA` → one `schema/pipeline-fsm.json`; both skills `jq -f` it; **delete**
  `check-pipeline-install.js` Check 4.
- Recruiter "Skills to install" → generated/read from disk; retire Check 1.
- Hook `command` blocks → real `.sh` files with `.bats` tests; drop the awk-scrape.
- Net effect: removes the highest-risk drift *and* deletes guard scripts (net-negative
  friction — aligns with the prior research's G1 "replace, don't add").

**Stage 1 — Type the frontmatter only (the valuable slice of Alternative B). Fast-follow.**
- Make `phase`, `domain`, `artifacts`, `tunables` typed/validated at build time; keep the
  body as authored prose. Replaces `check-skill-structure.ts` presence-linting with a
  real type-check. Do **not** build the full body-codegen layer.

**Stage 2 — Stand up a scoped, advisory golden-eval harness (Alternative C). Fast-follow.**
- promptfoo config + CI workflow covering the few high-stakes *behavioral* contracts that
  no structural check can see: `roster-run` mode classification, `roster-research`
  blindness, the review verdict shape. Born **advisory**; promote to blocking only on
  measured precision (the prior research's G3). This is the only stage that touches the
  genuinely-irreducible prose, so it is the long-term complement to Stage 0, not a
  substitute.

**Stage 3 — Constrained emission where the runtime supports it (Alternative D). Opportunistic.**
- Schema-constrain the review verdict / state-ledger / friction emissions via structured
  output, **capability-detected per runtime** (never assumed — roster is multi-runtime).
  Cheap win on malformed JSON; explicitly *not* a fix for the substrate problem.

**Explicitly not now:** the full DSPy rewrite (E — incompatible with human-readable,
multi-runtime, no-labeled-data) and the full deterministic orchestration engine (F —
fights the platform constraint). Their *philosophy* — typed contracts at boundaries,
control flow as data — is already captured by Stages 0–1. Revisit F only via the prior
research's **W0** (per-target hooks/CI), which is the one place a deterministic execution
layer can live inside today's runtimes.

**Through-line:** the substrate problem and the prior verdict-trust problem are the same
principle at two altitudes. Prior work: *don't trust an agent's self-reported verdict —
recompute it from a disjoint oracle.* This work: *don't trust prose to carry logic — lift
the logic into a typed core the prose merely references.* Both replace "the model asserts
it" with "a mechanism guarantees it." Stage 0 is the cheapest, highest-leverage instance of
that principle anywhere in roster, because each value-recomputing `check-*.js` invariant (Check 4's
FSM, Check 1's install list) is already a proof that the thing it guards was never prose to begin
with — as opposed to the property-checking guards (kb-links, structure linters) that legitimately
verify real prose.

---

## 5. Sources

Structured / constrained generation:
- [Constrained Decoding: Grammar-Guided Generation for Structured LLM Output — Michael Brenndoerfer](https://mbrenndoerfer.com/writing/constrained-decoding-structured-llm-output)
- [LLM Structured Outputs: Schema Validation for Real Pipelines (2026) — Collin Wilkins](https://collinwilkins.com/articles/structured-output)
- [Generating Structured Outputs from Language Models: Benchmark and Studies (JSONSchemaBench, arXiv:2501.10868)](https://arxiv.org/html/2501.10868v1)
- [Structured Outputs Are Becoming the Default Contract for LLM Integrations — G360](https://g360technologies.com/structured-outputs-are-becoming-the-default-contract-for-llm-integrations/)

Spec-as-source / prompt-as-code / codegen drift:
- [Structured-Prompt-Driven Development (SPDD) — Martin Fowler](https://martinfowler.com/articles/structured-prompt-driven/)
- [The Ultimate Guide to Adopting a Prompt as Code Framework — AI Prompt Architect](https://aipromptarchitect.co.uk/blog/prompt-as-code-framework)
- [Spec-Driven Development (SDD): The Definitive 2026 Guide — BCMS](https://thebcms.com/blog/spec-driven-development)
- [Handling generated code in Rush — 7 ton shark](https://7tonshark.com/posts/handling-generated-code-in-rush/)
- [The Drift We're Not Talking About: AI Code Generation — Vijay Poudel](https://medium.com/@vijay.poudel1/the-drift-were-not-talking-about-a-developer-s-reality-with-ai-code-generation-bc8fe2826b2e)
- [Why Generated Code Isn't the Problem With AI App Builders — MindStudio](https://www.mindstudio.ai/blog/why-generated-code-isnt-the-problem)

Golden / snapshot eval harnesses + CI gating:
- [promptfoo — GitHub](https://github.com/promptfoo/promptfoo)
- [CI/CD Integration for LLM Eval and Security — Promptfoo docs](https://www.promptfoo.dev/docs/integrations/ci-cd/)
- [End Vibe-Driven Development: Testing AI Agents in CI Pipelines (Promptfoo + Golden Traces)](https://medium.com/@meryemmsakinn/end-vibe-driven-development-testing-ai-agents-in-ci-pipelines-promptfoo-golden-traces-b9b222b23d72)
- [AI Agent Eval Harness: Golden Tests and Drift Detection — Motom](https://www.motomtech.com/blog-post/agentic-ai-eval-harness-golden-tests/)

Thin LLM over typed core / deterministic orchestration:
- [Blueprint First, Model Second: A Framework for Deterministic LLM Workflow (arXiv:2508.02721)](https://arxiv.org/abs/2508.02721)
- [Compiled AI: Deterministic Code Generation for LLM-Based Workflow Automation (arXiv:2604.05150)](https://arxiv.org/html/2604.05150)
- [Deterministic AI Orchestration: A Platform Architecture — Praetorian](https://www.praetorian.com/blog/deterministic-ai-orchestration-a-platform-architecture-for-autonomous-development/)

DSLs / declarative compilation:
- [DSPy — GitHub](https://github.com/stanfordnlp/dspy) · [DSPy: Compiling Declarative LM Calls (arXiv:2310.03714)](https://arxiv.org/pdf/2310.03714)
- [Is It Time To Treat Prompts As Code? DSPy case study (arXiv:2507.03620)](https://arxiv.org/html/2507.03620v1)

Agent frameworks' stance:
- [LangGraph: Building Production-Ready Deterministic Workflows — Ranjan Kumar](https://ranjankumar.in/building-production-ready-ai-agents-with-langgraph-a-developers-guide-to-deterministic-workflows)
- [Guardrails — OpenAI Agents SDK](https://openai.github.io/openai-agents-python/guardrails/) · [Handoffs — OpenAI Agents SDK](https://openai.github.io/openai-agents-python/handoffs/)

Agent-Skills / SKILL.md standard:
- [Equipping agents for the real world with Agent Skills — Anthropic](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [SKILL.md: The Open Standard for AI Agent Skills — Agensi](https://www.agensi.io/learn/agent-skills-open-standard)
- [Agent Skills: Progressive Disclosure as a System Design Pattern — SwirlAI](https://www.newsletter.swirlai.com/p/agent-skills-progressive-disclosure)

Prior roster research (build-on, not repeat):
- `docs/research/determinism-FINAL-2026-05-31.md` and siblings (branch `wip/benchmarks`) —
  the C1–C47 verdict-disjointness program and the W0 per-target enforcement installer.
