---
name: retrospec-skill
type: spec
status: live
feature: roster-spec-infer — evidence-tiered retroactive spec skill
brief: briefs/retrospec-skill-intake.md
date: 2026-05-25
version: 1.0.0
---

# Spec — roster-spec-infer

## User Stories

### US-1: Evidence-Tiered Spec Generation (Priority: P0)

As a developer working on a legacy or underspecified codebase, I want to run `roster-spec-infer` on a project directory so that I receive a `specs/<slug>-inferred.md` artifact where every behavioral claim is labeled with its evidence level — `[E1]` (test-verified), `[E2]` (code-inferred), or `[E3]` (doc-claimed) — and each claim includes a `file:line` or `commit:<sha>` citation.

**Why this priority**: Without this artifact, `spec-compliance-auditor` has nothing to run against on codebases that never went through `roster-spec`. This is the primary deliverable; all other stories depend on it.

**Independent Test**: Running the skill on a JavaScript project with ≥1 passing test (`npm test` exits 0) produces `specs/<slug>-inferred.md` containing ≥1 claim labeled `[E1]` with a `file:line` citation pointing to a test file.

### US-2: TRACE Conflict Detection (Priority: P0)

As a developer, I want the skill to run two independent analyses — one reading only implementation code (no comments, docs, or README), another reading implementation + all documentation — and flag any claim where the two analyses disagree as `[CONFLICT: doc-drift suspected]` with both versions shown so that I can manually adjudicate cases where documentation drifts from actual code behavior.

**Why this priority**: The TRACE finding documents that LLMs trust stale documentation over correct code, causing 7–42 point detection drops in naive approaches. A single analysis pass inherits whatever drift the documentation carries. Without dual-run conflict detection the inferred spec is unreliable on codebases with stale documentation.

**Independent Test**: Given a project where a README asserts behavior A but the code implements behavior B, the skill's `## Conflicts` section contains ≥1 `CONFLICT-N` entry showing both behavior A (doc version) and behavior B (code version) for the same claim.

### US-3: Mandatory Gap Registration (Priority: P1)

As a developer, I want every exported/public API surface in the analyzed codebase with zero E1 evidence (no passing test covering it) to appear as a named `GAP-N` entry in the `## Gaps` section of the output — explicitly labeled with the uncovered symbol or module — so that silence never implies completeness and coverage blind spots are always visible.

**Why this priority**: Without mandatory gap registration, a partial inferred spec is indistinguishable from a complete one. A developer cannot tell whether a section is absent because it was not analyzed or because no tests exist.

**Independent Test**: Running the skill on a project with an exported function that has zero test coverage produces a `## Gaps` section with ≥1 `GAP-N` entry naming that function or its module.

### US-4: spec-compliance-auditor Integration Announcement (Priority: P1)

As a developer, I want the skill to conclude by printing `Run /spec-compliance-auditor specs/<slug>-inferred.md` (with the actual slug substituted) so that I know immediately how to detect behavioral drift between the inferred spec and the current implementation.

**Why this priority**: The inferred spec is actionable only if the developer knows the next step. The pairing workflow (infer → audit) closes the gap-to-action loop. Without this announcement the output is orphaned.

**Independent Test**: After running the skill on any project, the final output contains the literal string `Run /spec-compliance-auditor specs/<actual-slug>-inferred.md`.

### US-5: Git History Annotation (Priority: P2)

As a developer, I want git commit messages and `git log --follow` traces for key implementation files to be mined and surfaced as `commit:<sha>` annotations on behavioral claims so that I can understand why a behavior exists — intentional design decision or accumulated drift — not just that it exists.

**Why this priority**: Evidence without provenance cannot distinguish intentional design from accidental behavior. Commit history is the cheapest available source of design intent in projects without ADRs or formal specs.

**Independent Test**: Running the skill with `include_git_history: true` on a git repository with ≥3 commits produces ≥1 behavioral claim annotated with `commit:<sha>` where `<sha>` is a valid commit in the repository's history.

## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | US-1 | **Evidence label collision with Ralph Loop**: The brief uses "Tier 1/2/3" for evidence strength; the Ralph Loop uses "Tier 1/2" for quality gate categories. Both labels appear in the same repo. | Rename all evidence labels to `[E1]`/`[E2]`/`[E3]` throughout the skill definition and output artifact. Use "Evidence Level" (not "Tier") in all documentation. Ralph Loop "Tier 1/2" is never used in inferred spec output. |
| C-2 | US-1 | **Why include E3/doc-claimed claims if US-2 treats docs as drift suspects?** Including E3 claims gives them false authority alongside test-verified E1 claims. | E3 claims are retained as inputs to conflict detection (US-2). They carry an explicit `[E3: lowest confidence — verify against code]` annotation. E3 claims that conflict with E2 produce CONFLICT entries. E3 claims without E1/E2 corroboration must not be treated as authoritative — stated explicitly in the skill's Rules. |
| C-3 | US-1 | **E2 "code-inferred" has no confidence threshold**: A 50%-confidence LLM inference and a 95%-confidence inference both become E2 claims. | E2 is an ordinal label, not a probability. The label itself communicates "inferred, not test-verified." The skill's Rules state: "E2 claims represent best-effort static inference. Do not treat them as equivalent to E1." No numeric score is tracked. |
| C-4 | US-2 | **Code-only LLM run may be contaminated by training data**: An LLM's "code-only" context may still be influenced by training data that includes documentation for the same libraries. | Mitigation is mechanical, not cognitive: the Code-Only Analyzer sub-agent's context window contains zero documentation files (README, *.md, docstrings, JSDoc excluded from its read list). Training-data contamination is an acknowledged out-of-scope limitation. This covers the majority of practical TRACE-style drift (stale READMEs, outdated docstrings). |
| C-5 | US-2 | **Conflict detection does not identify "truth": both runs may be wrong in the same direction.** If both analyzers infer "returns 200" when code returns 204, no CONFLICT is raised. | Conflict detection is signal detection, not truth verification. Its purpose is to surface cross-version disagreements for human adjudication. The skill must state: "Absence of CONFLICT does not certify correctness." E1 (test-verified) claims are the only self-certifying tier. This is why gap registration (US-3) is mandatory. |
| C-6 | US-2 | **No remediation path defined for CONFLICT entries**: When a CONFLICT appears, what does the developer do? Does the final spec contain the code version, the doc version, or both? | CONFLICT entries show BOTH versions and are excluded from the main `## Claims` section — they live in `## Conflicts` only, pending human resolution. The skill announces: "CONFLICT-N entries require manual resolution before the inferred spec can be treated as authoritative." |
| C-7 | All | **Sub-agent data contract undefined**: Four sub-agents run in separate contexts. Format of outputs, how the orchestrator collects them, and how data flows between steps are unspecified. | Each sub-agent outputs a structured markdown claim list: `- [EX] <claim text> (evidence: <file:line or commit:sha>)`. The orchestrator reads all four outputs sequentially. The orchestrator diffs Code-Only vs Code+Docs outputs to produce CONFLICT entries. No cross-agent live data sharing occurs. |
| C-8 | US-1 | **Sequential isolation loses cross-module invariants**: An invariant spanning Module A and Module B may not be detected by any single sub-agent. | Acknowledged V1 limitation. The skill must state: "Cross-module behavioral invariants requiring simultaneous knowledge of multiple modules may not appear in E2 claims." |
| C-9 | US-1 | **Test Miner cannot determine "passing" without language-specific knowledge**: Different frameworks report passing/failing differently. | Test Miner detects the test framework from project config files (package.json `scripts.test`, pytest.ini, go.mod, pom.xml) and runs the canonical test command. A claim is labeled E1 only if: (1) a test assertion is identified, AND (2) the suite exits 0. If no framework is detected, no E1 claims are emitted and all surfaces go to Gaps. |
| C-10 | US-1 | **"Tests passing" assumption invalid with no CI**: Tests may have last passed weeks ago on a project without CI. | Test Miner MUST run the test suite during skill execution. If tests fail (non-zero exit), the skill halts: "Test suite failed — E1 claims cannot be emitted. Fix test failures before running roster-spec-infer." |
| C-11 | US-5 | **Git history may be shallow, squashed, or absent**: Shallow clones and newly initialized repos have sparse history. | Git History Miner operates best-effort. Sparse history is documented in output. If the repo has no history or is not a git repo, the miner reports: "Git history unavailable — commit annotations omitted." The `include_git_history: false` tunable skips this sub-agent entirely. |
| C-12 | US-1 | **"Target" parameter scope is ambiguous**: Is `<target>` a file, directory, module, function, or entire codebase? | Target is a project root directory (`roster-spec-infer .` or `roster-spec-infer /path/to/project`). The skill analyzes the entire directory tree from that root, excluding standard ignored paths (node_modules, .git, build artifacts). Single-file or single-function analysis is out of scope for V1. |
| C-13 | US-1 | **Slug derivation is unstable and collision-prone**: Slug derivation is unspecified; two different targets could silently overwrite prior inferred specs. | Slug = lowercase directory name of target, spaces replaced by `-`, special characters stripped. If `specs/<slug>-inferred.md` already exists, the skill halts and prompts: "Inferred spec already exists for `<slug>`. Overwrite? [y/N]" and stops if not confirmed. |
| C-15 | US-1 | **No mechanism prevents treating inferred specs as authoritative**: Same directory, similar name pattern; `spec-compliance-auditor` cannot distinguish inferred from authoritative without metadata. | Dual protection: (1) `-inferred` suffix in filename (mandatory), (2) `type: inferred-spec` frontmatter field (mandatory). The skill's Rules state: "Never produce output without both markers." A warning is printed at completion: "This artifact is inferred, not authoritative." |
| C-17 | US-3 | **Gap list may be unusably long at scale**: `gap_threshold: 0` means every untested public symbol is registered. On a 100k LOC project this could be thousands of GAP entries. | `gap_threshold: 0` is the correct default for completeness — no gap is silently omitted. For large codebases, users set `gap_threshold: N` to suppress entries for modules with fewer than N uncovered symbols. A non-zero default would silently miss gaps in the most common case. |
| C-18 | US-3 | **Intentional gaps are indistinguishable from accidental ones**: Both appear as GAP entries. | The skill does not attempt to distinguish intent. Git History Miner may annotate a GAP with a relevant commit message if one exists. Distinguishing intentional from accidental gaps is a human decision. |
| C-19 | US-3 | **"Module boundary" definition is language-specific**: TypeScript `export`, Python public (no underscore), Go uppercase, Java `public` all differ. | A module boundary is any symbol accessible to code outside its defining file via the language's standard export mechanism. If the language is unknown, the skill falls back to file-level granularity (each file = one potential gap). |
| C-22 | All | **KB skill vs. pipeline skill classification conflict**: KB skills use flat Steps with no sub-agents; roster-spec-infer requires 4 sequential sub-agents — matching pipeline complexity. | KB domain is correct. The `phase` field (absent from KB skills) is the mechanical boundary: pipeline skills participate in the sequenced roster pipeline; KB skills are invoked on-demand. roster-spec-infer has no `phase` and is not triggered by roster-run. Sub-agent orchestration is an implementation pattern, not a classification criterion. |

## Acceptance Criteria

- AC-1 [US-1, C-9, C-10]: Test Miner runs the project's canonical test command (detected from config files), and emits E1 claims only for assertions covered by tests that produce exit code 0.
- AC-2 [US-1, C-1]: All claims in `specs/<slug>-inferred.md` use `[E1]`, `[E2]`, or `[E3]` labels — not "Tier 1", "Tier 2", "Tier 3" — to avoid collision with Ralph Loop quality gate terminology.
- AC-3 [US-1 happy path]: Running the skill on a project with ≥1 passing test produces `specs/<slug>-inferred.md` containing ≥1 `[E1]`-labeled claim with a `file:line` citation.
- AC-4 [US-2, C-4]: The Code-Only Analyzer sub-agent's context window contains zero documentation files (README.md, *.md docs, docstrings, JSDoc comments excluded) — verified by the sub-agent prompt definition in the skill file.
- AC-5 [US-2, C-6]: Claims where Code-Only and Code+Docs Analyzers disagree appear ONLY in `## Conflicts` (as `CONFLICT-N` entries with both versions shown), never in the main `## Claims` section.
- AC-6 [US-2 happy path]: On a codebase where a README states behavior A and code implements behavior B, the output `## Conflicts` section contains ≥1 `CONFLICT-N` entry showing both behavior A and behavior B.
- AC-7 [US-3 happy path]: Every exported/public API surface with zero E1 evidence appears as a `GAP-N` entry in `## Gaps`, named with the uncovered symbol or module.
- AC-8 [US-3, C-13]: If `specs/<slug>-inferred.md` already exists, the skill halts and prompts for confirmation before overwriting.
- AC-9 [US-4 happy path]: The final skill output contains the literal string `Run /spec-compliance-auditor specs/<slug>-inferred.md` with the actual slug substituted.
- AC-10 [US-5 happy path]: When `include_git_history: true` (default), the Git History Miner annotates ≥1 claim with `commit:<sha>` where `<sha>` is a valid 7+ character hex commit hash in the repository.
- AC-11 [US-1, C-10]: If the test suite fails (non-zero exit code), the skill halts: "Test suite failed — E1 claims cannot be emitted. Fix test failures before running roster-spec-infer."
- AC-12 [US-1, C-12]: If a file path (not directory) is given as target, the skill halts: "Target must be a directory (project root). Got: `<path>`."
- AC-13 [US-1, C-15]: Output frontmatter contains `type: inferred-spec` (not `type: spec`) and the filename ends with `-inferred.md`.
- AC-14 [US-1, C-15]: Skill prints at completion: "This artifact is inferred, not authoritative. Do not use as a ground truth for new implementations."

## Edge Cases

- EC-1: No tests found in target directory → No E1 claims emitted; all surfaces registered as GAP entries; skill completes with: "No test suite detected — all surfaces are E2/E3 or GAP."
- EC-2: Test suite fails (non-zero exit) → Skill halts (see AC-11); user must fix tests before re-running.
- EC-3: No documentation files found → Code+Docs Analyzer output is identical to Code-Only Analyzer; no CONFLICT entries expected; output notes: "No documentation found — conflict detection not applicable."
- EC-4: `include_git_history: true` but target is not a git repo → Git History Miner emits: "Target is not a git repository — commit annotations omitted."
- EC-5: `specs/<slug>-inferred.md` already exists → Halt and prompt (see AC-8).
- EC-6: Target directory with zero exported/public symbols → Gaps section: "No public API surface detected. Gap registration not applicable."
- EC-7: `gap_threshold` exceeds total uncovered symbols → Gaps section: "No gaps meet threshold N. Lower gap_threshold to see all gaps."
- EC-8: Sub-agent context limits exceeded on very large codebase → Test Miner caps at top-N most-tested files and documents: "Analysis limited to top N files due to context constraints. Increase specificity of target."

## Runnable Checks

- CHECK-1 [AC-3]: `cd <project-with-passing-tests> && roster-spec-infer . && grep -c '\[E1\]' specs/*-inferred.md` → expected: integer ≥ 1
- CHECK-2 [AC-2]: `grep -E '\bTier [123]\b' specs/*-inferred.md` → expected: no output (exit code 1 — no Ralph Loop tier labels in artifact)
- CHECK-3 [AC-5]: `grep 'CONFLICT' specs/*-inferred.md | grep -v '^## Conflicts' | grep -v 'CONFLICT-'` → expected: no output (CONFLICT keyword only in Conflicts section and CONFLICT-N entries)
- CHECK-4 [AC-7]: `cd <project-with-untested-export> && roster-spec-infer . && grep -c '^- GAP-' specs/*-inferred.md` → expected: integer ≥ 1
- CHECK-5 [AC-9]: `roster-spec-infer . 2>&1 | grep 'Run /spec-compliance-auditor'` → expected: output contains `Run /spec-compliance-auditor specs/<slug>-inferred.md`
- CHECK-6 [AC-11]: `cd <project-with-failing-tests> && roster-spec-infer . 2>&1 | grep 'Test suite failed'` → expected: non-zero exit, message contains "Test suite failed — E1 claims cannot be emitted"
- CHECK-7 [AC-13]: `grep '^type: inferred-spec' specs/*-inferred.md && ls specs/*-inferred.md` → expected: both match; no file named `*-inferred.md` has `type: spec`
- CHECK-8 [AC-4]: `grep -A5 'Code-Only Analyzer' skills/kb/roster-spec-infer.md | grep -i 'exclude\|no doc\|no readme\|documentation'` → expected: exclusion list present in sub-agent prompt definition
- CHECK-9 [AC-10]: `cd <git-repo-3-plus-commits> && roster-spec-infer . && grep -cE 'commit:[a-f0-9]{7,}' specs/*-inferred.md` → expected: integer ≥ 1
- CHECK-10 [AC-14]: `roster-spec-infer . 2>&1 | grep 'inferred, not authoritative'` → expected: output contains the warning string

## Entities

- `InferredSpec`: A `specs/<slug>-inferred.md` artifact produced by `roster-spec-infer`, typed `type: inferred-spec`, containing evidence-labeled behavioral claims, a `## Gaps` section, and an optional `## Conflicts` section — distinct from authoritative specs (`type: spec`) produced by `roster-spec`.
- `EvidenceLevel`: The three-level ordinal scale for claim credibility: `[E1]` (test-verified, highest), `[E2]` (code-inferred via static analysis), `[E3]` (doc-claimed, lowest). Distinct from Ralph Loop "Tier 1"/"Tier 2" quality gate categories.
- `GapEntry`: A `GAP-N` entry in `## Gaps` identifying a public API surface or module boundary with zero E1 evidence.
- `ConflictEntry`: A `CONFLICT-N` entry in `## Conflicts` where the Code-Only and Code+Docs analyses produced different claims for the same behavior; excluded from `## Claims` pending human resolution.
- `TestMiner`: Sub-agent 1 of 4 — detects test framework, runs the test suite, extracts behavioral assertions from passing tests, produces E1 claims with `file:line` citations.
- `CodeOnlyAnalyzer`: Sub-agent 2 of 4 — reads implementation code with zero documentation in context; produces E2 claims as the code-first ground truth.
- `CodeDocsAnalyzer`: Sub-agent 3 of 4 — reads implementation + all documentation files; produces an independent claim set; disagreements with CodeOnlyAnalyzer become ConflictEntries.
- `GitHistoryMiner`: Sub-agent 4 of 4 — reads `git log --follow` and commit messages for key implementation files; produces `commit:<sha>` annotations and rejected-approach notes.
- `DualRunConflictDetection`: The TRACE-mitigation mechanism where the orchestrator diffs CodeOnlyAnalyzer and CodeDocsAnalyzer outputs; any disagreement becomes a ConflictEntry in `## Conflicts`.
- `SlugDerivation`: Rule for producing `<slug>` from target directory name — lowercase, spaces → `-`, special characters stripped; collision check against existing `specs/<slug>-inferred.md` before writing.
