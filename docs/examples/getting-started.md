# Getting Started with Agent Roster

## Prerequisites

- Node 20 or later installed (`node --version` should print `v20.x.x` or higher)
- TypeScript available globally or via npx (`npx tsc --version`)
- Clone agent-roster: `git clone https://github.com/your-org/agent-roster && cd agent-roster`

## The Sample Project

The fixture at `docs/examples/fixtures/sample-project/` is a small TypeScript CLI called `sample-cli`. It accepts `--count N` and `--format (table|json)` flags and prints a numbered list of items. The project has two intentional bugs and incomplete test coverage. First, `parser.ts` line 21 slices `argv` at index 1 instead of 2 — `process.argv` is `[node, script, ...args]`, so slicing at 1 includes the script path as the first apparent argument, silently misaligning every flag read after it. Second, `formatter.ts` line 15 uses `item.length` instead of `i + 1` for row numbering, so every row in table output displays the character-length of the item string rather than its position. Tests cover only two basic cases in `parser.ts`; `formatter.ts` has no tests at all, and there is no test for invalid `--count` input.

## Step 1: Recruit Your Team

From the root of your project (here, `docs/examples/fixtures/sample-project/`), run the `/recruit` command in your Claude Code session. The recruiter scans the project and assembles a team appropriate to the work.

```
[recruiter] Scanning project...
Mode: greenfield (no .claude/agents/ found)
Recommended team:
  - implementer  (score 9/10) — fix bugs, add tests
  - reviewer     (score 8/10) — diff review + policy check
  - qa           (score 8/10) — independent test run
  - tech-lead    (score 7/10) — orchestrate pipeline
Installing to .claude/agents/...done (4 agents)
```

Expected: the recruiter selects implementer, reviewer, QA, and tech-lead. It does not select architect or kb-agent — the project is small and has no specification document yet, so those roles have no material to work with.

## Step 2: Tech-Lead Research Brief

The tech-lead reads the project and writes a brief for the implementer. The brief is scoped to observable issues in the source — it does not invent requirements.

```
Project: sample-cli v0.1.0
Issues found:
  - parser.ts:21  — argv slice off-by-one (BUG, Tier 1)
  - formatter.ts:15 — row numbering uses item.length (BUG, Tier 1)
  - formatter.ts — no test coverage (MISSING TESTS, Tier 1)
  - parser.ts — no test for invalid --count (MISSING TESTS, Tier 2)
Completion criteria:
  Tier 1: npm test passes, both bugs fixed, formatter test added
  Tier 2: invalid input test added
```

Tier 1 items are blocking: the branch cannot merge with known bugs and zero formatter coverage. Tier 2 items are expected but non-blocking if time is constrained.

## Step 3: Implementer Fixes

The implementer receives the research brief and the relevant source files. It does not receive prior conversation context — the brief is the sole input.

Changes made:

- `src/parser.ts` line 21: `argv.slice(1)` → `argv.slice(2)`
- `src/formatter.ts` line 15: `item.length` → `i + 1`
- `tests/formatter.test.ts` (new): tests `formatOutput` for table and json modes
- `tests/parser.test.ts`: adds a test for invalid `--count` (expects throw)

Implementer handoff note:

```
Files changed:
  src/parser.ts       — fixed argv slice index (line 21)
  src/formatter.ts    — fixed row numbering (line 15)
  tests/formatter.test.ts — new: 2 tests (table format, json format)
  tests/parser.test.ts    — added: 1 test (invalid --count throws)
Tests: 5 pass, 0 fail
npm test output:
  ✔ parseArgs: default count is 10 (1.2ms)
  ✔ parseArgs: --count flag sets count (0.8ms)
  ✔ parseArgs: invalid --count throws (0.6ms)
  ✔ formatOutput: table format numbers rows correctly (0.9ms)
  ✔ formatOutput: json format is valid JSON (0.7ms)
```

## Step 4: Reviewer Pass

The reviewer receives the diff, the review brief, and the implementer's handoff note. It does not receive prior conversation context or QA results.

Reviewer checks:

- [x] Both bugs fixed (verified at correct lines)
- [x] formatter test covers table and json modes
- [x] parser test covers invalid input
- [x] No file exceeds 500 lines
- [x] No function exceeds 50 lines

Reviewer flags (non-blocking):

- `formatter.ts` has no handling for unknown `format` values — silently returns an empty string. The function should either throw an error or default to a documented fallback. This is a real defect present in the fixture: `formatter.ts` reaches the final `return ""` for any value other than `"table"` or `"json"` without logging a warning or raising an exception.

Reviewer verdict: **CONDITIONAL PASS**

Condition: the unknown-format silent-return behavior should be fixed or explicitly documented as a follow-up issue before the next phase.

Expected: the reviewer flags the unknown-format silent failure. This is not a false alarm — the defect is present in the code as written. A reviewer that does not flag it has missed a real issue.

## Step 5: QA Verification

QA receives the phase requirements and the implementer's handoff claims. It does not receive the diff or the reviewer's findings — its job is to verify claims independently, not to re-audit the code.

QA runs `npm test` independently on the worktree branch:

```
✔ parseArgs: default count is 10 (1.1ms)
✔ parseArgs: --count flag sets count (0.9ms)
✔ parseArgs: invalid --count throws (0.5ms)
✔ formatOutput: table format numbers rows correctly (0.8ms)
✔ formatOutput: json format is valid JSON (0.6ms)
pass: 5, fail: 0
```

QA verifies handoff claims:

- [x] Claimed 5 tests — actual 5 tests ✓
- [x] Both bugs fixed — verified by test pass ✓
- [x] formatter.test.ts exists — confirmed ✓

QA report: **All claims verified. No disputes.**

Expected: QA passes all claims. QA does not flag the unknown-format issue — that is the reviewer's domain and QA did not see the diff. A QA agent that raises new code findings (instead of verifying handoff claims) is operating outside its role.

## Outcome

The human reviews two reports:

- Reviewer: CONDITIONAL PASS — one non-blocking condition (unknown-format handling)
- QA: all claims verified, 5/5 tests passing

The human approves merge. The tech-lead merges the worktree branch to main.

The unknown-format condition is tracked as a carry-forward item. It becomes Tier 1 in the next phase brief, where the implementer will add a guard (`throw new Error(...)` for unsupported format values) and a corresponding test.
