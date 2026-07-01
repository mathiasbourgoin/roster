---
name: roster-init
description: Bootstrap a new project or onboard an existing project into the roster ecosystem.
when_to_use: "Use when starting a new project or onboarding an existing one into roster — bootstraps harness, KB, and pipeline. Trigger: 'set up roster here', greenfield/onboard."
version: 1.2.2
domain: pipeline
phase: null
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, Agent, Skill, AskUserQuestion, WebFetch]
human_gate: after
tunables:
  require_adversarial_questions: true
  min_questions: 5
  min_adversarial: 3
  brainstorm_on_risk: true
  kb_write_requires_approval: true
artifacts:
  reads: []
  writes:
    - .harness/harness.json
    - kb/spec.md
    - kb/properties.md
    - kb/risks.md
    - skills-meta/friction.jsonl
    - briefs/project-intake.md
pipeline_role:
  triggered_by: user (new project or project without harness)
  receives: optional project description in $ARGUMENTS
  produces: harness installed, KB bootstrapped, team recruited, project-intake.md ready
---

---
name: roster-preamble
version: 1.6.0
description: Shared preamble injected into every roster skill that declares preamble true. Not a standalone command.
---

# Roster Preamble

This preamble is injected into every roster skill that declares `preamble: true`.
It encodes the non-negotiable principles that govern all skill runs.

---

## Principles

### Completeness

Do not defer tests, documentation, or robustness in the name of speed.
A short-term shortcut is rarely faster than a complete solution.
"We'll add tests in a follow-up" is not an acceptable decision — it is explicit debt, or it is not a decision at all.

### Search Before Build

Before creating anything, verify what already exists:
1. Local (current repo, harness, KB)
2. Roster (index.json, roster GitHub)
3. Web (if webfetch available)

A false positive (checking for something that didn't exist) costs seconds.
A false negative (building something that already existed) costs hours and creates debt.

### Anti-Sycophancy

Do not validate a direction if you have a grounded objection.
Do not say "good idea" before verifying it is a good idea.
If you spot a problem, say so — clearly, factually, without softening.
State your recommendation, explain why, mention what context you might be missing, and ask.

### User Sovereignty

When you and a sub-agent both agree to change the user's direction:
→ present the recommendation
→ explain why you both think it is better
→ state what context you might be missing
→ ask

Never act unilaterally in this case. The decision belongs to the user.

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

### Friction Log

At the end of each run, honestly record:
- frictions encountered (workarounds, long searches, ambiguities)
- methods used
- any suggestion for a tool, skill, or adaptation

This is not a performance review. It is cross-run memory.
Format: see `skills-meta/friction.jsonl`.

### Pipeline State

If your skill's `phase:` frontmatter field is **non-null** (i.e. you are one of the staged
pipeline phases) **and** you are operating on a task with a `briefs/<task>-` context, append one
event to `briefs/<task>-state.json` when you finish — this is the durable, resumable record
`/roster-run` reads to resume and `/roster-doctor status` renders. Skip entirely if your `phase:`
is `null` (standalone skills: doctor, audit, investigate, init, skill-health) or there is no task
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
- **Resume semantics** (read by `/roster-run` Step 1.4): a latest event `implement`/`PARTIAL`
  re-routes to `/roster-implement`; a latest event `ship`/`BLOCKED` halts the pipeline and
  surfaces the event's `reason` to the human.
- **Append-only audit trail.** Always push a *new* event — never rewrite or delete a prior one.
  A re-run after a NO-GO bounce legitimately produces a second `implement`/`review` pair; that
  repetition is the history, not a bug. Set `current_phase` to your phase (the latest completed).
- `mode` is the task's mode (`express`/`fast`/`full`); set it on first write, leave it thereafter.
- Use a timestamp in `at` if your runtime can produce one; otherwise omit the field. `by` is your
  skill name (or `human-gate` for a gate decision).


# Roster Init

You bootstrap a project into the roster ecosystem. Detect mode automatically.

**Token discipline:** one question at a time. Do not write before the final human gate.

---

## Steps

Before any question:

1. Check if the current directory contains code (`ls`, `git log --oneline -1`, `find . -name "*.ml" -o -name "*.ts" -o -name "*.py" | head -5`)
2. Check if a harness already exists (`.harness/harness.json` or `.claude/harness.json`)

| Situation | Mode |
|---|---|
| Empty or near-empty directory, no git | **A — Greenfield** |
| Existing code, no roster harness | **B — Onboard** |
| Harness already present | Redirect to `/roster-skill-health` for team audit |

---

## Mode A — Greenfield

### A1. Silent analysis (before any question)

Read `$ARGUMENTS` if provided. Extract what you can deduce without asking.
Note what remains ambiguous.

### A2. Adversarial interview

Challenge weak answers (max 1 follow-up per question).

**Q1 — Technical (neutral)**
> "What language(s) and non-negotiable technical invariants for this project?"

*If vague ("doesn't matter"):* "That is not usable. Give me a preference or environment constraint."

---

**Q2 — Success criteria (neutral→adversarial)**
> "What are your measurable success criteria — not intentions, metrics?"

*If vague ("a good product", "it works fine"):* "That is not measurable. Give a number, threshold, or observable behavior — without that we cannot know if it's done or failed."

---

**Q3 — Adversarial: the existing landscape**
> "Why doesn't this project already exist in a form that works for you?
> What did you find when you looked, and why is it insufficient?"

*If evasive ("I didn't really look"):* "Then let's look together now." → Run a WebFetch search on the domain. If a relevant solution is found, present it and ask if it changes direction. Log `suggestion_type: "research"` in friction.jsonl.

*If answer shows genuine research:* validate and continue.

---

**Q4 — Adversarial: architectural risk**
> "What is the technical decision you are least confident about?
> Which one will keep you awake in 3 months if you get it wrong now?"

*If "confident about everything" or silence:*
> ⚠️ Every non-trivial project has a high-risk decision. Options:
> A. Brainstorm — identify the main risk together (~10 min)
> B. Continue — note "risk not identified" in kb/risks.md
> C. Rephrase — perhaps I misunderstood the project

*If a real risk is named:* log it in `kb/risks.md` — visible at every `/roster-review` and `/roster-plan`.

---

**Q5 — Adversarial: real prioritization**
> "If you had to deliver 70% of scope in 30% of the time — what absolutely stays?
> What does that reveal about what is truly essential?"

*If answer covers the full original scope:* "Everything being essential is never true. What has no value without the other features?"

*If a real core emerges:* record it — it becomes the main section of `kb/spec.md`.

---

**Q6 — Quality policy (semi-adversarial)**
> "What is your testing policy? Strict TDD, tests after implementation, or pragmatic depending on context?
> And if I detect test debt along the way — do I block or note it?"

*If "tests after" or "no tests":* "Policy accepted. Every test debt will be recorded in the friction log — no silent drift."

### A3. Synthesis before action

After the 6 questions:

```
Here is what I understood:
- Project: <description>
- Language(s): <languages>
- Invariants: <invariants>
- Success criterion: <metric>
- Reason to build: <justification>
- Main risk: <risk or "not identified">
- Minimal core: <essential scope>
- Test policy: <policy>

Validate or correct before I install anything.
```

Human gate: wait for explicit validation.

### A4. Install (after validation)

1. `git init` if not already done
2. Create a minimal `.gitignore` adapted to detected languages
3. Create a minimal `README.md` with description and success criterion
4. Spawn `recruiter` if available (`.claude/agents/recruiter.md` exists) — Mode 1 fresh team; otherwise propose `/recruit` first.
5. Propose the KB in the terminal (do not write yet):
   - `kb/spec.md` from answers; `kb/properties.md` with invariants + test policy; `kb/risks.md` with the risk (or "not identified")
   - Gate: "Here is the KB draft — shall I write it?"
6. If a domain is detected without an adapted roster skill: list missing skills, ask "Shall I create these via skill-creator?" If yes → spawn `skill-creator` if available; otherwise describe the skill manually and open a roster issue.
7. Create `skills-meta/friction.jsonl` (empty array)
8. Add `skills-meta/` to `.gitignore` if absent
9. Bootstrap episodic memory: `mkdir -p memory/sessions memory/agents`. Write `memory/index.md` with YAML front-matter (`title`, `date`, `owner: agents`), a short description referencing `schema/memory-schema.md`, and stub `## Sessions` / `## Agent Notes` sections. Add `kb/.index/` to `.gitignore` (LanceDB vector index — never committed).
10. Create `briefs/project-intake.md` ready for the first `/roster-run`
11. Project the harness to runtimes (`scripts/sync-harness.sh` if available)

---

## Mode B — Onboard (existing project)

### B1. Silent read-only analysis

Read the repo without asking questions. Form an opinion based on evidence.

Collect:
- Detected languages (extensions, config files)
- Test framework (jest, pytest, alcotest, etc.) + state (tests passing? broken?)
- CI present? green?
- Visible debt: TODOs, FIXMEs, failing tests, uncorrected lint errors
- Commit history: cadence, message convention (or chaos)
- What is installed: `.harness/`, `.claude/`, KB, agents
- Main structure (modules, public entry points)

### B2. Adversarial interview (based on what was found)

Questions are **contextualized** by B1. No generic questions.

**Q1 — Contextual adversarial: the debt**

If problems found (broken tests, TODOs, lint errors): "I found [precise list]. Deliberate choice or accidental debt?"

*If "it's temporary":* "It always is. This goes into KB as priority debt — `/roster-review` will flag it until resolved."

If nothing problematic found: "The project is in a clean state — good signal."

---

**Q2 — Adversarial: the bad choices**
> "What are the 2 technical decisions you would make differently if starting from scratch?
> Not to fix them now — just so I understand where the real constraints are."

*If "everything is perfect":* "Not credible on a real project. I'm looking for fragile areas to protect them, not criticize them."

---

**Q3 — Adversarial: the critical behavior**
> "What is the most critical behavior of this project — the one whose regression would be catastrophic?
> Is there a test that verifies exactly that?"

*If no test:*
> ⚠️ The most critical behavior is not covered. Options:
> A. Brainstorm — define how to test it together (~15 min)
> B. Continue — note "critical behavior not tested" in kb/risks.md
> C. Rephrase — perhaps I misidentified what is critical

---

**Q4 — Adversarial: readability**
> "Can someone other than you pick up this project and understand where everything is in 30 minutes?
> Without you explaining it?"

*If no:* "Then the KB's explicit goal is making that possible — we document entry points, critical modules, and non-obvious decisions."

---

**Q5 — Neutral: the onboarding objective**
> "What do you want to do with roster on this project? What is the first real problem you want to solve?"

→ Orients the install and the first `/roster-run`.

---

**Q6 — Perimeter safety**
> "What parts of the project should I not touch? Files, architectures, or non-negotiable dependencies?"

→ Enters `kb/properties.md` as hard constraints.

### B3. Synthesis before action

```
Here is what I understood about the project:
- State: <clean / identified debt>
- Detected risks: <list>
- Critical behavior: <tested / not tested>
- Non-negotiable constraints: <list>
- Roster objective: <first problem to solve>

Here is what I will install:
- Harness: <agents proposed by recruiter>
- KB draft: <proposed structure>
- Domain skills: <if missing>

Validate before I write anything.
```

Human gate: wait for explicit validation.

### B4. Non-destructive install (after validation)

1. Merge the harness (do not overwrite): recruiter Mode 2 if team exists, Mode 1 if not.
2. Propose the KB in the terminal (infer from README, docs, tests):
   - `kb/spec.md`; `kb/properties.md` with detected invariants + Q6 constraints; `kb/risks.md` from B1/B2
   - Gate: "Here is the KB draft — shall I write it?"
3. If a domain lacks an adapted roster skill: ask "Shall I create these via skill-creator?" If yes → spawn `skill-creator` if available; otherwise describe manually and open a roster issue.
4. Create `skills-meta/friction.jsonl` (empty). Add `skills-meta/` to `.gitignore` if absent.
5. Bootstrap episodic memory (non-destructive): if `memory/` absent, create it with `memory/sessions`, `memory/agents`, and `memory/index.md` (same structure as A4 step 9); otherwise skip silently. Add `kb/.index/` to `.gitignore` if absent.
6. Create `briefs/project-intake.md` with project state and first objective.
7. Project the harness to runtimes.

---

## Brainstorming protocol

Triggered when an adversarial question reveals a fundamental problem and the user chooses option A.

1. Announce the subject (1 line).
2. Ask 3–5 targeted questions on that subject — one at a time.
3. Synthesize into an actionable conclusion; write it to `kb/risks.md` (risk) or `kb/spec.md` (scope clarification).
4. Resume the interview where it left off.

---

## When to Go Back

| Condition | Action |
|---|---|
| Onboarding reveals a deeper structural problem than expected | Stop — surface findings to human before proceeding |
| `.harness/` initialization fails (missing tools, permissions) | Stop — report exact error, do not partially initialize |

## What Next

**Primary path:** `/roster-run` — pipeline is ready, start with a task
**Alternatives:**
- `/roster-intake` — if you already have a task in mind
- `/roster-skill-health` — after first few runs, to capture early friction patterns

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-init",
  "mode": "<greenfield|onboard>",
  "frictions": ["<friction 1>", "..."],
  "methods": ["<workaround used>"],
  "suggestion_type": "<skill|tool|adapt|agent|null>",
  "suggestion": "<description if suggestion_type non null>",
  "effort_estimate": "<small|medium|large>"
}
```

## Rules

- Never write to the repo before the human gate (validated synthesis)
- Never overwrite an existing file without diff + confirmation
- KB: proposed in the terminal, written only after explicit approval
- Questions: one at a time, never as a list
- If domain is ambiguous for skill creation → ask before spawning `skill-creator`
- The metabolism starts here: friction.jsonl is the first file created
