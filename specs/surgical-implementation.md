---
name: roster-spec
type: spec
status: live
feature: Surgical implementation discipline (prose + review scope gate + manifest-freeze hook)
brief: briefs/surgical-implementation-intake.md
date: 2026-07-10
version: 1.1.0
---

> **v1.1.0 amendments (post plan dual-voice challenge):** deny mechanism corrected to Claude Code's real contract (JSON `permissionDecision: "deny"`; exit 1 does NOT block — verified against https://code.claude.com/docs/en/hooks.md); scope gate implemented as a tested script (`scripts/check-scope-diff.sh`), not prose Bash; gate runs on the FINAL changed set (after review auto-fixes); loop-back manifest re-derivation excludes scope-finding paths unless ACCEPTED (closes an automatic-bypass hole); artifact allowances narrowed (`specs/<task-slug>*` only, not `specs/`); manifest grammar pinned; reviewer-agent defer condition communicated via spawn instructions. Out-of-scope discoveries flagged, not fixed: `hooks/safety/block-dangerous-commands.md` exits 1 (likely silently non-blocking in Claude Code) and `schema/hook-schema.md:68-72` documents the wrong contract.

# Spec — Surgical Implementation Discipline

## Clarifications

| Q | A |
|---|---|
| What registrations does the new hook require beyond the sync-harness scan? | `CORE_HOOKS` array in `scripts/init-harness.sh` (or it silently never installs) + hand-edit of AGENTS.md "Tool-level hooks (2)" → "(3)" with a table row (`check:catalog-sync` counts rows vs heading). |
| Do the enum extensions break validators/routers? | No. `check-schema-enums.ts` validates only catalog/rule enums; review finding categories and `no_go_reason.type` are prose-only. roster-run routes unknown NO-GO types to `/roster-implement` (catch-all), so no roster-run edit. |
| Crash leaves `briefs/ACTIVE_TASK` behind — are later sessions frozen? | Hook fail-opens when the named manifest is missing; a stale-but-complete pair is recovered via Bash (`rm briefs/ACTIVE_TASK`, human-confirmed) — the deny message documents this. |
| Is ACTIVE_TASK itself Edit/Write-allowed? | No — both control files (ACTIVE_TASK, active manifest) are denied FIRST, before any allowance; they are written/cleared via Bash only (Bash is unmatched by design — no self-lockout). |
| Who normalizes absolute `file_path` vs repo-relative manifest entries? | The hook: `realpath -m` then strip repo root (`git rev-parse --show-toplevel`). Paths outside the repo root are ALLOWED (scratchpad/tmp are legitimate) — the manifest governs repo files only. |
| Manifest entry grammar? | Exact repo-relative file paths, or directory prefixes ending in `/` (prefix match). No glob wildcards — deterministic string matching, no dialect ambiguity. |
| How does roster-implement detect Full mode for the manifest lifecycle? | `briefs/<task>-implementer.md` exists (plan-produced sub-brief). Express/Fast have no manifest by design. |
| Which diff base does the review gate use? | The `base=<sha>` recorded in the manifest header (HEAD at implement-phase start) — never a hardcoded branch name; pre-task dirty files are recorded in the header and excluded from the gate. |

## User Stories

### US-1: Surgical implementation directive (Priority: P0)
As a pipeline operator, I want the implement phase and implementer agent to mandate the smallest diff that fully satisfies the brief, so that produced diffs contain no tangled unrelated modifications (evidence: tangled refactorings reduce compilation success, arXiv 2605.22526; 54% of agent refactorings are incidental, arXiv 2511.04824).
**Why this priority**: cheapest layer, zero infrastructure risk, and the wording other layers reference.
**Scope**: This story does NOT cover mechanical enforcement, does NOT weaken the existing thoroughness rule, and does NOT edit the OCaml specialists (they already carry "minimal correct patches; no speculative refactors").
**Independent Test**: grep the two edited files for the directive; verify the old "no unsolicited large refactors" sentence was absorbed, not duplicated; `npm test` green.
**Acceptance Scenarios**:
1. **Given** `skills/pipeline/roster-implement.md` after the change, **When** a maintainer reads the section that previously held the token-discipline line (line 32), **Then** it mandates "smallest diff that fully satisfies the brief — completeness first, then minimality", flag-don't-fix via Friction Log, and permitted removal of change-orphaned code and dead code within manifest files.
2. **Given** `agents/backend/implementer.md` after the change, **When** a maintainer reads its Rules, **Then** a surgical rule is present, the thoroughness rule ("do not stop short of complete work") is intact, and the version is bumped minor (1.3.0 → 1.4.0).
3. **Given** the edited files, **When** `npm test` runs, **Then** `check:skills`, `check:agents`, and `check:catalog-sync` pass (AGENTS.md rows updated to the new versions).

### US-2: Deterministic review scope gate (Priority: P0)
As a reviewer, I want roster-review to deterministically compare the changed-file set against the task's declared manifest, so that out-of-manifest changes produce a HIGH `scope` finding and a NO-GO the human can either fix or explicitly accept.
**Why this priority**: converts scope discipline from unverifiable prose (roster-review.md:106) into a gate; this is the layer with direct GO/NO-GO authority.
**Scope**: This story does NOT change roster-run routing, does NOT add a diff-size cap, and does NOT gate Express/Fast mechanically (no pre-declared manifest exists there by design).
**Independent Test**: with a fixture manifest and a diff containing one out-of-manifest file, the review procedure yields a HIGH scope finding and `no_go_reason.type: "out-of-scope-change"`.
**Acceptance Scenarios**:
1. **Given** `briefs/t-manifest.txt` listing `src/a.ml` with header `base=<sha>`, and a diff since `<sha>` touching `src/a.ml` and `src/b.ml`, **When** the scope gate runs, **Then** it emits `{severity: HIGH, category: "scope", path: "src/b.ml", line: 0, fingerprint: "src/b.ml:0:scope"}` and the verdict is NO-GO with `no_go_reason.type: "out-of-scope-change"`.
2. **Given** the same finding, **When** the human marks it ACCEPTED in the grouped ambiguity pass, **Then** it no longer blocks and the verdict can be GO (standard finding mechanics — this is the review-level escape hatch).
3. **Given** a Full-mode task whose manifest file is absent, **When** the gate runs, **Then** exactly one MEDIUM informational finding "scope gate skipped — no manifest" is emitted and no NO-GO results from it.
4. **Given** an Express-mode task, **When** roster-review runs, **Then** the mechanical gate is skipped silently and the reviewer agent instead assesses diff-vs-task-description plausibility (prose dimension).

### US-3: Manifest lifecycle + PreToolUse freeze hook (Priority: P1)
As a safety layer, I want roster-implement (Full mode) to declare its file manifest at phase start and a tool-level hook to deny Edit/Write outside it, so that accidental scope drift is blocked at the moment of the edit, not discovered at review.
**Why this priority**: strongest layer but needs the manifest lifecycle; deliberately last (layers 1–2 stand alone).
**Scope**: This story does NOT cover Bash/NotebookEdit/MCP/worktree enforcement (enumerated as documented gaps), does NOT support concurrent Full tasks (single ACTIVE_TASK slot, escalate on conflict), and is NOT a security boundary (same trust model as block-dangerous-commands).
**Independent Test**: with fixture ACTIVE_TASK + manifest, pipe a PreToolUse JSON payload into the hook's command block: in-manifest path → exit 0; out-of-manifest path → exit 1 with BLOCKED message; no ACTIVE_TASK → exit 0.
**Acceptance Scenarios**:
1. **Given** `briefs/ACTIVE_TASK` containing `t` and `briefs/t-manifest.txt` allowing `src/`, **When** the hook receives `{"tool_input":{"file_path":"<repo>/src/x.ml"}}`, **Then** it exits 0.
2. **Given** the same state, **When** the hook receives `{"tool_input":{"file_path":"<repo>/lib/y.ml"}}`, **Then** it exits 1 and prints a BLOCKED message naming `lib/y.ml`, task `t`, the human-approval extension path (via Bash), and the stale-state recovery line.
3. **Given** no `briefs/ACTIVE_TASK` (or a slug whose manifest is missing, or a path outside the repo root, or `git rev-parse` failing), **When** the hook fires, **Then** it exits 0 (fail-open outside an active Full implement phase).
4. **Given** an active manifest, **When** the hook receives a payload targeting `briefs/ACTIVE_TASK` or the manifest itself, **Then** it exits 1 (control files denied before any allowance is evaluated).

## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | US-1 | No tie-breaker between "smallest change" and "be thorough" | Wording fixes precedence: completeness first, then minimality — minimal relative to what the brief requires (a 40-file rename required by the brief IS minimal) |
| C-2 | US-1 | "Near the token-discipline line" untestable; duplicate-wording drift | Directive absorbs/replaces the existing sentence at roster-implement.md:32; no duplication |
| C-3 | US-1 | "In-scope removal" undefined; layer 1 could permit what layers 2–3 punish | Defined: code orphaned by your change + dead code within manifest files. Out-of-manifest removal = flag, don't fix (consistent with code-quality.md) |
| C-4 | US-1 | OCaml sub-agents never receive the directive | They already carry "minimal correct patches; no speculative refactors" (ocaml-implementer.md:41,52) — no edit |
| C-5 | US-1 | Version-bump convention unstated | Minor bump for behavior-affecting prose; AGENTS.md rows are the mechanical check (check:catalog-sync) |
| C-6 | US-2 | Intake said check:schema-enums "may" validate the enums | Verified: it does not (only catalog/rule enums). Spec supersedes the intake's hedge |
| C-7 | US-2 | Hardcoded `main...HEAD` base → false NO-GO on next-cut branches | Base is `base=<sha>` recorded in the manifest header at phase start — never a branch name |
| C-8 | US-2 | Pre-existing working-tree dirt → false HIGH findings | Pre-task dirty files recorded in the manifest header, excluded by the gate; porcelain renames count both paths; `-uall` for untracked files |
| C-9 | US-2 | Free-form markdown Files list ≠ deterministic input | The gate reads only `briefs/<task>-manifest.txt` (plain lines). The one-time markdown→manifest derivation happens in roster-implement, human-visible |
| C-10 | US-2 | Mandatory regenerated projections are out-of-manifest → guaranteed NO-GO | Manifest derivation MUST include collateral paths required by quality gates (e.g. generated projections). The gate has no implicit allowances beyond pipeline artifacts |
| C-11 | US-2 | Gate vs auto-fix ordering | Gate computes the changed set at review entry, before auto-fixes; auto-fixes restricted to manifest files (FR-020) |
| C-12 | US-2 | Unconditional NO-GO vs ACCEPTED path | Standard mechanics: OPEN → NO-GO; human ACCEPTED unblocks. Acceptance IS the review-level escape hatch |
| C-13 | US-2 | Scope findings have no line/evidence | Fixed shape: line 0, fingerprint `<path>:0:scope`, evidence = the diff/status line |
| C-14 | US-2 | Deletions/renames vs permitted removal cleanup | Deletion of an out-of-manifest file = scope violation (human decides); renames match old AND new path. No contradiction with C-3's bounded removal |
| C-15 | US-2 | "Catch-all routing" asserted, not cited | Cited: roster-run routing table — "review NO-GO (any other reason) → /roster-implement". Correct destination: removing out-of-scope hunks is implement work. roster-review.md's :258 enum comment updated |
| C-16 | US-2 | Double-reporting: reviewer agent + gate | Reviewer agent dimension is conditional: defer to the gate when a manifest gate ran; assess vs task description only in Express/Fast |
| C-17 | US-2 | Loop-back fixes touch files not in the original Files list | Manifest re-derived on loop-back: original ∪ review.json finding paths (findings sanction fix locations) |
| C-18 | US-3 | Worktree isolation defeats the hook (gitignored control files absent) | Accepted v1 limitation, enumerated in the hook's gap list; enforcement boundary = orchestrating session |
| C-19 | US-3 | Stale ACTIVE_TASK after crash freezes later sessions | Fail-open when manifest missing; deny message carries the recovery line (`rm briefs/ACTIVE_TASK`, human-confirmed); PARTIAL keeps it active (resume expected) |
| C-20 | US-3 | Self-lockout: clearing ACTIVE_TASK via Write is denied | All control-file writes/clears mandated via Bash (unmatched by design); deny-first ordering makes the exclusion implementable without pattern negation |
| C-21 | US-3 | Blocking out-of-repo paths breaks scratchpad/tmp | Reversed: out-of-repo paths are ALLOWED. The manifest governs repo files only |
| C-22 | US-3 | Glob dialect ambiguity (`*` crosses `/` in case-patterns) | No globs at all: exact paths or `dir/` prefixes, `realpath -m` normalization. Deterministic |
| C-23 | US-3 | Single global ACTIVE_TASK slot vs concurrent sessions | Documented: one active Full implement per repo; roster-implement escalates if the slot is held by another slug |
| C-24 | US-3 | Gap list undefined ("documented" with no content) | Enumerated: Bash, NotebookEdit, MCP tools, worktrees (fail-open), concurrent sessions. Best-effort, not a security boundary |
| C-25 | US-3 | .gitignore edit needed? AGENTS.md generated? | Neither: `briefs/` is wholesale gitignored already; AGENTS.md tool-hook table is hand-maintained (verified — populate-catalog-rows.js has no hook handling) |
| C-26 | US-3 | Per-loop human escalation for every review-driven fix | Resolved by C-17: loop-back manifests ingest review.json finding paths automatically |

## Functional Requirements

#### Surgical Implementation Directive (US-1)
- **FR-001** [US-1]: The roster-implement skill and the implementer agent definition MUST each carry a surgical-implementation directive instructing the implementer to produce the smallest diff that fully satisfies the brief.
- **FR-002** [US-1]: The directive MUST order the two goals explicitly: completeness first (the brief is fully satisfied), then minimality (no smaller diff would also satisfy it).
- **FR-003** [US-1]: The directive MUST instruct the implementer to leverage existing abstractions before introducing new ones.
- **FR-004** [US-1]: The implementer MUST NOT apply out-of-scope improvements; when identified, it MUST record them in the Friction Log or the "Identified out-of-scope" section instead.
- **FR-005** [US-1]: The directive MUST permit removal of code orphaned by the implementer's own change and dead code within files listed in the task manifest.
- **FR-006** [US-1]: The directive wording MUST NOT weaken the existing thoroughness rule.
- **FR-007** [US-1]: The directive MUST absorb the existing "no unsolicited large refactors" sentence in roster-implement.md; that sentence MUST NOT appear as a duplicate alongside the new directive.
- **FR-008** [US-1]: The OCaml specialist agent definitions MUST NOT be edited (they already carry equivalent wording).
- **FR-009** [US-1]: Each edited skill/agent file MUST receive a minor version bump, and its corresponding AGENTS.md catalog row MUST be updated to match.

#### Deterministic Review Scope Gate (US-2)
- **FR-010** [US-2]: When `briefs/<task>-manifest.txt` exists, roster-review MUST run the scope gate on the FINAL changed set — after auto-fixes have been applied — so the gated state is the state that ships (v1.1.0: supersedes "before auto-fixes"; any out-of-manifest change in the final state is a violation regardless of author).
- **FR-011** [US-2]: The changed-file set MUST be computed by `scripts/check-scope-diff.sh` as the union of `git diff --name-only <base-sha-from-manifest-header>...HEAD` and `git status --porcelain -uall`, minus the pre-task dirty files recorded in the manifest header (known blind spots, documented in the script: a task edit to a pre-task-dirty file is excluded; a mid-phase third-party file is attributed to the task and must be human-ACCEPTED).
- **FR-012** [US-2]: Renames MUST count both the old and new path as changed files; deletions MUST count as changed files (porcelain `R old -> new` lines parsed into both paths).
- **FR-013** [US-2]: For every changed file that matches no manifest entry (exact path or `dir/` prefix), the script MUST emit a finding with severity HIGH, category "scope", line 0, fingerprint `<path>:0:scope`, and the corresponding diff/status line as evidence; roster-review MUST merge these findings verbatim.
- **FR-014** [US-2]: Any OPEN scope finding MUST set the review status to NO-GO with `no_go_reason.type` = "out-of-scope-change".
- **FR-015** [US-2]: The value "out-of-scope-change" MUST be added to the `no_go_reason.type` enum comment in roster-review.md, and "scope" to the finding category enum.
- **FR-016** [US-2]: roster-run MUST NOT be edited; its existing "any other reason → /roster-implement" catch-all MUST handle routing of the new NO-GO reason.
- **FR-017** [US-2]: A human MUST be able to ACCEPT a scope finding, and an ACCEPTED scope finding MUST unblock the NO-GO exactly like any other accepted finding.
- **FR-018** [US-2]: In Full mode, if the manifest file is absent, roster-review MUST emit a single MEDIUM informational finding "scope gate skipped — no manifest" and MUST NOT set NO-GO for that reason.
- **FR-019** [US-2]: In Express and Fast modes, roster-review MUST skip the scope gate silently.
- **FR-020** [US-2]: Review auto-fixes MUST NOT modify any file outside the manifest entries when a manifest is present.
- **FR-021** [US-2]: The reviewer agent MUST carry a runtime-agnostic scope review dimension: assess whether the diff stays within the assigned scope (sub-brief files or task description).
- **FR-022** [US-2]: roster-review MUST state in the spawned reviewer's instructions whether a deterministic scope gate ran; when told it ran, the reviewer agent MUST defer scope to it and MUST NOT emit its own scope findings (the condition is communicated via spawn instructions — the generic agent has no pipeline knowledge of its own).
- **FR-041** [US-2]: A script `scripts/check-scope-diff.sh` MUST exist implementing FR-011–FR-013 with the exit contract: 0 = no violations, 1 = violations found (findings JSON on stdout), 2 = degraded/unusable input (manifest missing or malformed — maps to the FR-018 informational finding).
- **FR-042** [US-2]: A unit test `scripts/check-scope-diff.test.js` MUST exercise the script against git fixtures (in-manifest change, out-of-manifest change, rename, deletion, pre-task dirty exclusion, missing manifest) and MUST be wired into `npm test`.

#### Manifest Lifecycle (US-3)
- **FR-023** [US-3]: In Full mode, roster-implement MUST derive `briefs/<task>-manifest.txt` via Bash at phase start from: the implementer brief's Files list (files to modify AND files to create, including test files named in plan steps), the pipeline artifact paths (`briefs/`, `roster/<task>/`, `specs/<task-slug>*`, `skills-meta/friction.jsonl` — NOT all of `specs/`), and the collateral prefixes mandated by the project's quality gates (e.g. generated projections). Prefixes broader than a directory named in the Files list or quality gates (e.g. `src/`, `./`) MUST NOT be derived without explicit human approval.
- **FR-024** [US-3]: The manifest MUST follow the pinned grammar: header = one `base=<sha>` line (full sha from `git rev-parse HEAD`) followed by zero or more `dirty=<path>` lines (one pre-task dirty file per line), then a `---` separator line, then one entry per line (exact repo-relative path, or directory prefix ending in `/`). Writer (roster-implement) and both readers (script, hook) MUST use this grammar verbatim.
- **FR-025** [US-3]: On a NO-GO loop-back, roster-implement MUST re-derive the manifest as the original entries united with the file paths of review.json findings EXCEPT paths of `category: "scope"` findings — those join the manifest only if their finding status is ACCEPTED (v1.1.0: closes the automatic-bypass hole; the expected fix for a non-accepted scope finding is reverting the file via git in Bash, which needs no Edit/Write access).
- **FR-026** [US-3]: If the brief's Files section is empty or unparseable, roster-implement MUST escalate to the human and MUST NOT guess manifest contents.
- **FR-027** [US-3]: If `briefs/ACTIVE_TASK` exists with a different slug at phase start, roster-implement MUST escalate to the human (overwrite or abort) and MUST NOT silently overwrite it.
- **FR-028** [US-3]: roster-implement MUST write the task slug to `briefs/ACTIVE_TASK` via Bash at phase start and MUST clear it via Bash at phase end, once the implementation brief is written.
- **FR-029** [US-3]: A PARTIAL phase outcome MUST leave `briefs/ACTIVE_TASK` in place.

#### Freeze Hook (US-3)
- **FR-030** [US-3]: A tool-level hook MUST exist at `hooks/safety/enforce-file-manifest.md` with frontmatter event `PreToolUse`, matcher `Edit|Write`, and a fenced command block.
- **FR-031** [US-3]: The hook MUST read the target path from stdin JSON field `.tool_input.file_path`.
- **FR-032** [US-3]: The hook MUST check deny conditions for `briefs/ACTIVE_TASK` and the active manifest file itself FIRST, before evaluating any allow condition, and MUST deny Edit/Write to either.
- **FR-033** [US-3]: The hook MUST allow (exit 0) when any of the following holds: `briefs/ACTIVE_TASK` is absent or empty; the named manifest file is missing; `git rev-parse --show-toplevel` fails; the normalized path (`realpath -m`, repo-root-relative) is outside the repo root; or the path matches a manifest entry.
- **FR-034** [US-3]: The hook MUST deny using Claude Code's documented contract — exit 0 with JSON on stdout: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: …"}}` — when the target path matches no manifest entry (v1.1.0: exit 1 does NOT block in Claude Code; verified against https://code.claude.com/docs/en/hooks.md). Allow = exit 0 with no JSON output.
- **FR-035** [US-3]: The `permissionDecisionReason` MUST name the blocked file and the active task slug, and MUST instruct the agent to ask the human to approve extending the manifest, extend it via Bash, then retry the edit.
- **FR-036** [US-3]: The `permissionDecisionReason` MUST include a stale-state recovery instruction: remove `briefs/ACTIVE_TASK` via Bash only after human confirmation.
- **FR-037** [US-3]: The hook documentation MUST enumerate its known gaps — Bash, NotebookEdit, MCP tools, git worktrees (fail-open), concurrent sessions (single slot) — and MUST describe the hook as best-effort defense-in-depth, not a security boundary.
- **FR-038** [US-3]: The hook file MUST be added to the `CORE_HOOKS` array in `scripts/init-harness.sh`.
- **FR-039** [US-3]: AGENTS.md MUST update the "Tool-level hooks" heading count from 2 to 3 and add a table row for the new hook.
- **FR-040** [US-3]: The hook MUST install into `.claude/settings.local.json` via sync-harness's `build_hooks_json`.

## Acceptance Criteria

- AC-1 [US-1, C-1, C-2]: roster-implement.md's directive block mandates completeness-first minimality, flag-don't-fix, bounded removal cleanup — and the old "no unsolicited large refactors" sentence appears exactly once (absorbed) → grep confirms.
- AC-2 [US-1]: implementer.md carries the surgical rule with the thoroughness rule intact, version 1.4.0 → grep + check:catalog-sync green.
- AC-3 [US-2, C-13]: Fixture manifest + out-of-manifest diff file → HIGH `scope` finding with fingerprint `<path>:0:scope` and NO-GO `out-of-scope-change` (procedure written in roster-review.md; enum comments updated).
- AC-4 [US-2, C-12]: ACCEPTED scope finding unblocks → GO (documented in roster-review.md scope-gate section).
- AC-5 [US-2, C-7]: Gate documentation references the manifest header `base=<sha>` — no hardcoded branch name in the gate command.
- AC-6 [US-3]: Hook command block, run standalone with fixture state, allows in-manifest, denies out-of-manifest with the full escalation message, denies control files, and fail-opens with no ACTIVE_TASK → CHECK-2/3/4.
- AC-7 [US-3, C-25]: `npm test` green after registration (CORE_HOOKS + AGENTS.md heading (3) + row) and `bash scripts/sync-harness.sh --check` reports no drift after projections are staged.
- AC-8 [US-3, C-24]: Hook doc contains the five-item gap list and the "not a security boundary" statement → grep.

## Edge Cases

- EC-1 [US-1]: Brief requires a broad mechanical change (40-file rename) → the 40-file diff IS minimal (minimality is relative to the brief; C-1).
- EC-2 [US-1/2/3]: Change orphans a helper in an out-of-manifest file → flag in Friction Log, don't delete (C-3); gate/hook consistently block the deletion.
- EC-3 [US-2]: Tree dirty before task start → pre-task dirty files in manifest header, excluded (C-8).
- EC-4 [US-2]: Task edits skills → regenerated projections in manifest via collateral-path derivation (C-10).
- EC-5 [US-2]: Branch cut from `next` → base is a recorded sha, immune to branch topology (C-7).
- EC-6 [US-2]: Rename from manifest path to non-manifest path → both paths checked; new path out-of-manifest → scope finding (C-14).
- EC-7 [US-3]: Empty/unparseable Files section → roster-implement escalates at derivation; no manifest guessed (FR-026).
- EC-8 [US-2]: Human accepts the extra file → ACCEPTED → GO (C-12).
- EC-9 [US-2]: Auto-fix wants to touch an out-of-manifest file → forbidden (FR-020); gate ran before auto-fixes anyway (C-11).
- EC-10 [US-2]: Stale implementer brief from an old task, current task Express → gate keys on THIS slug's manifest → absent → skipped silently (FR-019).
- EC-11 [US-3]: Crash leaves ACTIVE_TASK + manifest → deny message's recovery line; human-confirmed `rm` via Bash (C-19).
- EC-12 [US-3]: Implementer sub-agent in a worktree → control files absent there → fail-open; documented gap (C-18).
- EC-13 [US-3]: Write to scratchpad//tmp during active phase → out-of-repo → allowed (C-21).
- EC-14 [US-3]: Phase-end clear of ACTIVE_TASK → via Bash, unmatched by the hook → no deadlock (C-20).
- EC-15 [US-3]: Second Full task while slot held → roster-implement escalates: overwrite or abort (C-23).
- EC-16 [US-3]: Relative or symlinked file_path → `realpath -m` normalization; resolution outside repo → allowed (C-21/22).
- EC-17 [US-3]: Manifest entry `src/` prefix → matches `src/a/b/c.ml` by definition (prefix grammar, no globs; C-22).
- EC-18 [US-3]: NotebookEdit/MCP write while active → unmatched → allowed; enumerated gap (C-24).
- EC-19 [US-3]: Loop-back fix in a file named only in review.json → included by re-derivation (C-17/26).
- EC-20 [US-3]: Hook fires outside a git repo → `git rev-parse` fails → exit 0 (FR-033).

## Runnable Checks

- CHECK-1 [AC-1, AC-2]: `grep -c "smallest" skills/pipeline/roster-implement.md agents/backend/implementer.md` → expected: ≥1 per file; `grep -c "No unsolicited large refactors" skills/pipeline/roster-implement.md` → expected: ≤1.
- CHECK-2 [AC-6]: fixture run, allow path —
  ```bash
  cd "$(mktemp -d)" && git init -q . && mkdir -p briefs src && echo t > briefs/ACTIVE_TASK && printf 'base=%s\n---\nsrc/\nbriefs/\n' "$(git rev-parse HEAD 2>/dev/null || echo 0000)" > briefs/t-manifest.txt
  echo '{"tool_input":{"file_path":"'"$PWD"'/src/x.ml"}}' | bash <extracted command block>; echo "exit=$?"
  ```
  → expected: `exit=0`, empty stdout (no deny JSON).
- CHECK-3 [AC-6]: same fixture, `file_path=$PWD/lib/y.ml` → expected: exit 0, stdout is JSON with `"permissionDecision":"deny"` and a reason containing `BLOCKED`, `lib/y.ml`, `t`, and a recovery instruction.
- CHECK-4 [AC-6]: same fixture, `file_path=$PWD/briefs/ACTIVE_TASK` → expected: deny JSON (control file). Then `rm briefs/ACTIVE_TASK` and re-run CHECK-3's payload → expected: exit 0, empty stdout (fail-open).
- CHECK-9 [FR-041, FR-042]: `node --test scripts/check-scope-diff.test.js` → expected: exit 0 (git-fixture cases: in-manifest, out-of-manifest, rename, deletion, dirty exclusion, missing manifest).
- CHECK-5 [AC-3]: `grep -n "out-of-scope-change" skills/pipeline/roster-review.md` → expected: ≥2 matches (enum comment + gate section); `grep -n "scope" skills/pipeline/roster-review.md | grep -c "correctness|security|architecture|ux|spec|style|scope"` → expected: ≥1 (extended category enum).
- CHECK-6 [AC-7]: `grep -n "enforce-file-manifest" scripts/init-harness.sh AGENTS.md` → expected: ≥1 match in each.
- CHECK-7 [AC-7]: `npm test` → expected: exit 0.
- CHECK-8 [AC-8]: `grep -c -iE "worktree|NotebookEdit|MCP|concurrent" hooks/safety/enforce-file-manifest.md` → expected: ≥4.

## Entities

- `FileManifest`: `briefs/<task>-manifest.txt` — plain-line scope contract for one task: header (`base=<sha>`, pre-task dirty files), then allowed entries (exact repo-relative paths or `dir/` prefixes; no globs). Written by roster-implement via Bash, read by the review scope gate and the freeze hook.
- `ActiveTaskSlot`: `briefs/ACTIVE_TASK` — single-slot pointer holding the slug of the Full-mode task currently in its implement phase; gates hook enforcement; Bash-only writes.
- `ScopeFinding`: review finding with `category: "scope"`, `line: 0`, fingerprint `<path>:0:scope` — one per out-of-manifest changed file.
- `OutOfScopeChange`: new `no_go_reason.type` value `"out-of-scope-change"` — routed by roster-run's existing catch-all to `/roster-implement`.
- `FreezeHook`: `hooks/safety/enforce-file-manifest.md` — tool-level PreToolUse (Edit|Write) hook; fail-open without an active manifest; deny-first for control files; denies via JSON `permissionDecision: "deny"` (exit 0); best-effort defense-in-depth.
- `ScopeGateScript`: `scripts/check-scope-diff.sh` + `scripts/check-scope-diff.test.js` — the deterministic implementation of the review scope gate (exit 0/1/2 contract), invoked by roster-review; the manifest grammar's canonical reader.
