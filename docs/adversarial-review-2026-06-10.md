# Adversarial Review — agent-roster
**Date:** 2026-06-10 | **Model:** claude-fable-5 | **Dimensions:** 7 | **Raw findings:** 62 | **After dedup/triage:** 56

## Executive Summary

The project's design documents describe a sophisticated, layered safety and quality system, but the enforcement layer is largely fictional: both CI secret gates are trivially and verifiably bypassable (leak-ok marker with no delta-gate, agent-editable .check-leak-ignore), the documented "primary safety layer" of permissions.deny rules was never configured anywhere, and every human gate in the pipeline — including the load-bearing human-validation quiz protocol — is voluntary prose that no hook, test, or runtime mechanism backs. The pipeline itself has several silent-failure seams: the spec phase can be skipped by following intake's own routing, roster-spec stamps its own output VALIDATED, review's GO gate has no wait instruction, and the entire resume mechanism is keyed on a non-deterministic LLM-derived slug while the Full-mode task description is never persisted to disk. Schemas, manifests, and catalogs have drifted badly from reality — harness.json tracks 3 of 34 installed skills with stale versions, the linters enforce a contract nearly disjoint from what the schemas declare, and AGENTS.md/README/CHANGELOG all contain claims contradicted by the repo (several re-verified during triage). The unifying root cause is **guarantees declared in markdown and enforced by nothing**, so the system's safety and integrity currently rest entirely on agent cooperation. Remediation should start with the three criticals (close the two leak-gate bypasses and configure deny-rules), then mechanize the pipeline's human gates and routing seams, then add manifest/schema validation to stop the drift class permanently.

---

## Critical (3)

### C1 — check-leak-diff.sh has ZERO test coverage and the required delta-gate was never implemented
- **File:** `scripts/check-leak-diff.sh`
- **Problem:** An automated /roster-upgrade edit (or any author) can ship a real secret past CI by appending `# leak-ok` to the line. The code itself admits this is the threat model and that the fix belongs in the enforcement wiring — but the fix was never built, and no test would catch its absence. The delta-gate check-leak.js's own header says is REQUIRED (lines 24-28: "The leak-ok marker … is editable by the same agent … Real protection must be a delta-gate … that lives in the enforcement wiring above [check-leak-diff.sh], not here") does not exist: check-leak-diff.sh just calls `node check-leak.js` on the file list, which honors leak-ok unconditionally.
- **Evidence:** `grep` confirms NO test file references check-leak-diff.sh. A file containing `DB_PASSWORD=HHHHHHHHHHHHHHHHHHHH  # leak-ok` scans clean, exit 0. grep for delta/newly-added logic in check-leak-diff.sh returns 0 hits.
- **Blast radius:** Every push/PR. A leaked credential in any committed skill/pack reaches the public roster registry. This is the headline safety guarantee of the two-gate upgrade contract.

### C2 — Leak gate is fully defeatable via the agent-editable .check-leak-ignore file
- **File:** `scripts/check-leak-diff.sh:42-57`
- **Problem:** The script's own header guarantees: "the file list [is] derived from git diff — NOT from an agent-supplied argv … an automated upgrader cannot narrow the scan by omitting a file, because git decides the set." That guarantee is hollow. An upgrader can add a single line `*` (or `skills/*`) to `.check-leak-ignore` in the same PR; the diff scan then exempts every changed file. Git decides the file set, but the agent decides the ignore set — the narrowing is just moved one file over.
- **Evidence:** `check-leak-diff.sh reads ignore globs from `.check-leak-ignore` at repo root and skips any changed file whose path matches via `[[ "$f" == $g ]]`. Verified in bash: `g="*"` matches `skills/meta/roster-upgrade.md`, and `skills/*` also matches that nested path. No CODEOWNERS file exists.
- **Blast radius:** Total bypass of the generic leak gate for any change authored by the same actor (exactly the threatened automated /roster-upgrade path). CI shows green; secrets in skills land on main.

### C3 — The declared "primary safety layer" (permissions.deny) does not exist anywhere
- **File:** `.claude/settings.local.json`
- **Problem:** escalation.md:34 states: "Deny-rules are the primary safety layer … encode the destructive operations above as permissions.deny entries" and :42 "Prose states the intent; deny-rules + env config enforce it." But settings.local.json contains ONLY a `hooks` block, no `permissions.deny` key at all. There is no settings.json either. The one mechanism that does exist, the Bash hook, self-describes as "Best-effort, defense-in-depth against ACCIDENTAL destructive commands — NOT a security boundary." CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is also unset.
- **Evidence:** `jq keys` on settings.local.json = `["hooks"]` only. No settings.json anywhere in the repo.
- **Blast radius:** Every destructive operation in the repo. The whole escalation contract rests on a layer that was never configured; an agent ignoring the prose hits only a regex it can trivially evade.

---

## High (17)

### H1 — human-validation.md quiz protocol has zero hooks in the pipeline
- **File:** `skills/pipeline/roster-plan.md`
- **Problem:** The protocol is enforced by nothing. roster-plan's quiz contains three confirm-the-summary questions — exactly the "passive approval" pattern human-validation.md calls "silence" — with no consistency-check question and no comprehension question requiring the user to have read the plan file. roster-spec presents a spec with no quiz at all; roster-ship gates a merge decision with a bare "Push and open PR?" one-word-yes prompt, which the protocol explicitly forbids. The preamble never includes the validation-quiz obligation.
- **Evidence:** grep across skills/pipeline/ and skills/shared/preamble.md finds no reference to human-validation.md or its protocol. No PreToolUse/Stop hook references the quiz; compliance is entirely self-policed.
- **Blast radius:** All human gates in the pipeline. The project's load-bearing guarantee ("Agents propose. Humans decide.") degrades to rubber-stamp prompts on exactly the decisions the protocol was written for.

### H2 — roster-spec self-writes Status: VALIDATED with no final human gate
- **File:** `skills/pipeline/roster-spec.md`
- **Problem:** Frontmatter says `human_gate: after`, but the procedure never asks the human to validate the assembled spec. Steps 6–8 (requirements formalizer, consistency check, spec file write) all happen after the last human interaction, and step 9 stamps VALIDATED on its own output. A status that downstream routing treats as a gate verdict ("spec VALIDATED or SKIPPED → next phase (plan)") is self-granted.
- **Evidence:** Step 9 "Write Completion Artifact" writes `**Status:** VALIDATED` unconditionally. Step 10 "Announce": "Spec complete… Run `/roster-plan` to continue." The only human gate is Step 5, which resolves individual challenges — the final spec is never presented for approval.
- **Blast radius:** Every feature/api-change task in Full mode. The spec is the contract the implementation is reviewed against — an unvalidated spec makes that whole feedback loop authoritative on a document no human approved.

### H3 — Spec phase silently skippable: roster-intake routes to /roster-plan and roster-plan never checks for a spec
- **File:** `skills/pipeline/roster-intake.md`
- **Problem:** roster-run's table sends feature-type intakes to /roster-spec, but intake's own What Next is `/roster-plan` unconditionally. roster-plan has no guard requiring a spec artifact for feature tasks. Following the announced chain skips the spec phase with zero error.
- **Evidence:** roster-intake.md What Next: "**Primary path:** `/roster-plan`" — /roster-spec never mentioned. roster-run.md routing table does route to /roster-spec but the What Next doctrine says "follow the chain." roster-plan.md Input Contract only checks for the intake brief.
- **Blast radius:** Any Full-mode feature task driven by the announced What Next chain. The adversarial spec phase is bypassed silently, and review's spec-ac-failure NO-GO path becomes dead code for that task.

### H4 — roster-review's human gate is declarative only — GO proceeds with no wait-for-confirmation instruction
- **File:** `skills/pipeline/roster-review.md`
- **Problem:** Every other gated skill pairs its human gate with an explicit wait instruction; review only prints a summary. An agent following the text verbatim writes review.json with GO and proceeds to /roster-qa immediately. Contrast roster-intake step 6: "Wait for explicit validation", roster-ship step 4: "Wait for confirmation".
- **Evidence:** Frontmatter: `human_gate: after`. Step 7 "Human gate" contains no "wait for confirmation" sentence anywhere. It prints a summary then says "ready for /roster-qa."
- **Blast radius:** Every task. The review→qa seam advances on an unenforced gate; ACCEPTED criticals and mode-escalation flags can pass through without any human being blocked.

### H5 — Full-mode task description is never persisted to any artifact
- **File:** `skills/pipeline/roster-question.md`
- **Problem:** In Full mode the chain is question → research → intake, but no skill ever writes the task description to disk. questions.md explicitly excludes it (blind-research design), research.md excludes it. The context-budget rule mandates "A downstream skill should be able to start from the upstream artifact alone." On resume from a fresh session, intake receives a ≤4-word kebab slug and must reconstruct the Goal section from nothing.
- **Evidence:** roster-question.md: "Never include the task description or solution intent in `questions.md`." roster-research.md: "NEVER read a file named `task.md`…" and announces "Run `/roster-intake <task-slug>` to continue." roster-intake.md Input Contract: "`$ARGUMENTS`: task description or task slug."
- **Blast radius:** Every Full-mode task resumed in a fresh context. The intake brief's Goal — the single source of truth for plan, spec, implement, review — gets hallucinated from the slug.

### H6 — Pipeline state ledger depends on byte-identical slug derivation performed independently by each LLM phase
- **File:** `skills/shared/preamble.md`
- **Problem:** The durable, resumable record is keyed by a string that nine different skill executions must each re-derive identically from natural language. "Most significant words" is not a deterministic function. A single divergent derivation orphans the ledger: resume silently restarts the pipeline or duplicates phases. The preamble's own parenthetical is factually wrong: roster-question.md writes `roster/<task-slug>/questions.md`, not `briefs/<task>-*`, so two artifact namespaces coexist.
- **Evidence:** preamble.md lines 104-110: "≤4 most significant words (the same rule /roster-question and /roster-intake use to name briefs/<task>-*)." But roster-question.md:74-77 writes `roster/` not `briefs/`. roster-run Step 1.4 jumps to "fresh task" on filename miss with no instruction to scan for near-miss slugs.
- **Blast radius:** Every Full-mode pipeline run's resumability. /roster-run resume, /roster-doctor status, and NO-GO bounce re-entry all break silently on slug mismatch.

### H7 — Force-push to feature branches is required-to-escalate but never blocked; roster-ship runs one routinely
- **File:** `hooks/safety/block-dangerous-commands.md`
- **Problem:** escalation.md:9 flags "Force-pushing to any branch, including feature branches." The hook only fires when the command ALSO matches `\b(main|master)\b`. A force push to any other branch passes. roster-ship.md:108 executes `git push origin <branch> --force-with-lease` as a normal pipeline step.
- **Evidence:** Hook pattern: `grep -qE 'git push .*(-f|--force)' && grep -qE '\b(main|master)\b'`.
- **Blast radius:** Any non-main shared branch can be history-rewritten without escalation.

### H8 — External API calls with side effects (POST/PUT/DELETE, gh, MCP) bypass all enforcement
- **File:** `hooks/safety/block-dangerous-commands.md`
- **Problem:** escalation.md:16 requires escalation for "External API calls with side effects." The hook's only network rule blocks `(curl|wget) ... | sh` — piping to shell. `curl -X POST/DELETE` is not matched. The PreToolUse matcher is `Bash` only, so every MCP write tool (Slack, Gmail, Linear, Asana, Make…) bypasses the hook entirely.
- **Evidence:** roster-ship.md:109/121 runs `gh pr create` and `gh pr merge --rebase --delete-branch` (GitHub API writes) with no hook coverage.
- **Blast radius:** Any production mutation reachable via curl, gh, or an MCP server.

### H9 — Six categories of escalation triggers have zero enforcement
- **File:** `.claude/rules/escalation.md`
- **Problem:** CI/CD pipeline modifications, Auth/security changes, MCP server changes, Shared infrastructure, Cost threshold, and Properties file items — all advisory prose only. The PostToolUse Edit|Write hook runs a linter and "Always exit 0 — never blocks edits", so editing `.github/workflows/*`, auth config, or secrets files is unguarded.
- **Evidence:** None of these categories appear in the hook's blocked patterns or in any deny-rules.
- **Blast radius:** CI integrity, credentials/secrets, MCP trust config, and shared infra are all modifiable without any gate.

### H10 — The C3 self-upgrade invariant guard asserts on near-always-true tokens with NO negative test
- **File:** `scripts/check-roster-upgrade-invariants.test.js`
- **Problem:** A self-edit can gut the actual two-gate mechanism while leaving keywords in prose ("we no longer require propose-only; the gate may now auto-merge" still satisfies every predicate). The suite has only POSITIVE assertions: it reads the real file and checks tokens are present. It never constructs a deliberately-weakened skill body and asserts the invariants REJECT it.
- **Evidence:** `grep -c 'fail closed\|fail-closed' skills/meta/roster-upgrade.md` returns 4; the phrase survives almost any rewrite. No red fixture exists.
- **Blast radius:** The self-upgrade fixed-point guarantee. A weakening self-edit to the most safety-critical skill could land green.

### H11 — Backward `goto` in run-hook.ts is an unbounded infinite loop
- **File:** `scripts/run-hook.ts`
- **Problem:** `execSteps()` resolves `goto: <label>` by setting `i = targetIdx` with no visit counter or budget. A backward-goto hook hangs CI silently (a stuck check, not a red check). No test exercises the failure path. Empirically: a minimal backward-goto hook loops forever past 170 KB of output before being killed.
- **Evidence:** run-hook.ts lines 156-168: `i = targetIdx` with no bound. The `timeout:` operator only bounds an individual shell command, not the step loop.
- **Blast radius:** Any hook a skill author writes. A single bad goto stalls the pipeline and CI indefinitely.

### H12 — recruiter.md is a 1015-line monolith with hardcoded install list 16 skills stale
- **File:** `recruiter/recruiter.md`
- **Problem:** What-to-do is fused with how-to-run-it (embedded bash scripts, curl|bash auto-upgrade, per-runtime path matrices, ~100 lines of historical "remove this section after applying" notes that accumulate). The hardcoded skill list in "New Skill Discovery" (lines 893-910) is 16 entries stale: ambiguity-auditor, code-quality-auditor, git-conventions, harness-validator, image-generation, improvement-loop, improvement-loop-planner, kb-migrate, kb-reindex, kb-search, kb-update, roster-config, roster-spec-infer, spec-compliance-auditor, tdd-workflow, team are all missing. Violates the 500-line file-length rule.
- **Evidence:** `comm` against actual skills/ tree confirms 16 missing. The preamble injection in recruiter prose duplicates what sync-harness.sh already does.
- **Blast radius:** Every fresh install silently ships an incomplete harness; recruiter-driven and sync-harness-driven renders can produce divergent projections.

### H13 — Two parallel orchestration systems (agent team vs skill pipeline) with no precedence rule
- **File:** `recruiter/recruiter.md`
- **Problem:** recruiter.md installs an agent team (tech-lead → planner → implementer → reviewer → QA) doing the same decomposition→implement→review→ship flow as the roster-* skill pipeline — two competing orchestration authorities with different brief formats, no shared ledger, and no document defining which wins on conflict.
- **Evidence:** Zero references to tech-lead in roster-run.md or roster-plan.md. Recruiter 2.5.0 notes: "The pipeline skills are independent of the agent team." — independence is not a conflict-resolution policy.
- **Blast radius:** Every Full-mode task on a project with both installed (the default after Mode 1 step 7). Affects briefs/ integrity, review gate semantics, and the state ledger.

### H14 — Governor has no enforcement authority
- **File:** `governor/governor.md`
- **Problem:** The governor generates rule prose files and exits. No audit loop, no deny-rule application, no recurring governance check wired into review/qa/ship gates. The governor never applies the enforcement config its own rules recommend, perpetuating the missing deny-layer. governor.md:51 defines its own "compact diff for approval" step without invoking the human-validation.md quiz protocol — two parallel approval mechanisms. It lists an `agent-scope` rule (:39) that does not exist in .claude/rules/.
- **Evidence:** governor.md (69 lines) is reachable only via recruiter Mode 5. Has no `phase:` field. No gate anywhere checks its output is honored.
- **Blast radius:** All safety-critical behavior. Escalation triggers, sycophancy controls, scope limits — honored only as long as the context window happens to retain and respect the prose.

### H15 — Structure linters enforce a different contract than the schemas declare
- **File:** `scripts/check-agents.ts`
- **Problem:** check-agents.ts enforces NONE of the 8 required fields from agent-schema.md; instead it hard-requires the "Optional" `pipeline_role` field plus an `## Output Contract` section with `**Next:**` — neither appears in agent-schema.md's Body Structure. An agent file following the schema exactly fails CI; a schema-invalid file ships undetected.
- **Evidence:** agent-schema.md Required: name, display_name, description, domain, tags, model, complexity, compatible_with. check-agents.ts enforces: pipeline_role (optional in schema), ## Output Contract section (absent from schema).
- **Blast radius:** Every new agent/skill authored from the schema docs will fail `npm test`; recruiter instructs to "Follow schema/agent-schema.md" and will produce failing agents.

### H16 — harness.json layers.skills lists 3 skills while 34 are installed
- **File:** `.claude/harness.json`
- **Problem:** The manifest that harness-schema.md calls "the complete shared harness configuration" tracks under 10% of the installed skill surface. Everything that reasons from layers.skills (skill tunable overrides, skill-evolve version bumps, profile diffs, team-review staleness audits) concludes the pipeline is not installed.
- **Evidence:** `jq '.layers.skills | length' .claude/harness.json` = 3. `.claude/commands/` contains 34 projected skills including the entire pipeline.
- **Blast radius:** roster-config, roster-skill-health/evolve, team-review, and profile switching all silently skip 31 installed skills.

### H17 — harness.json is never validated against harness-schema.md — only JSON syntax checked
- **File:** `scripts/sync-harness.sh`
- **Problem:** harness-schema.md is documentation-only. sync-harness.sh line 42: `if ! jq empty "$MANIFEST" 2>/dev/null` is the only check. Any structural drift (wrong enums, missing required layer fields, stale versions) passes `npm test` silently. This is the root cause enabling the 3-of-34 gap, the malformed metabolism block, and the version drift findings.
- **Evidence:** No script in scripts/ validates harness.json fields, enums, or layer shapes against schema/harness-schema.md.
- **Blast radius:** All agents/skills reading harness.json as source of truth; drift accumulates invisibly across every installed project.

---

## Medium (22)

### M1 — roster-ship's post-merge KB sync commits and pushes with no gate, on an undefined branch
- **File:** `skills/pipeline/roster-ship.md`
- **Problem:** By step 8 the task branch is merged and deleted. Step 8 then runs `git push` with no branch argument — most plausibly directly to main. A content-bearing commit (KB changes) lands with no review, no QA, no PR, and no human gate, directly violating the skill's own Rules section ("Never push without an explicit human gate").
- **Evidence:** Step 8 runs after step 6's `gh pr merge … --delete-branch` and step 7's confirmation. Rules: "Never push without an explicit human gate."
- **Blast radius:** Every shipped task in a KB-enabled project. Ungated KB writes poison every future pipeline run's inputs.

### M2 — rm -rf guards are narrow — mass deletion of named paths passes
- **File:** `hooks/safety/block-dangerous-commands.md`
- **Problem:** The rm guard only matches targets literally `/`, `~`, or `.`. So `rm -rf src/`, `rm -rf /home/mathias/dev/agent-roster`, `rm -rf "$HOME"`, `rm -rf $TARGET` all pass. Separately, `git push origin --delete main` and `git push origin :main` delete a protected branch but contain no `-f/--force` token.
- **Evidence:** `block-dangerous-commands.md:41,45`: target pattern only matches `(/|~|\.)`
- **Blast radius:** Recursive deletion of any named directory and deletion of shared remote branches proceed unblocked.

### M3 — Base64-encoded secrets produce a WARN (never fail) — high-entropy-blob is non-blocking
- **File:** `scripts/check-leak.js`
- **Problem:** `high-entropy-blob` is classified WARN (lines 72-77), and main() returns 0 for warnings-only. In the automated /roster-upgrade path there is no human eyeballing the WARN line. A base64-encoded private key or any secret encoded to dodge the literal HIGH shape patterns (which key on prefixes like AKIA/ghp_/sk_) passes the gate with exit 0.
- **Evidence:** check-leak.test.js line 80 asserts a 60+ char base64 run is WARN, and the suite treats it as non-blocking.
- **Blast radius:** Any encoded credential in a committed skill bypasses the leak gate end-to-end.

### M4 — Express classification lists "dependency bump" under "no behaviour change"
- **File:** `skills/pipeline/roster-run.md`
- **Problem:** A dependency bump cannot satisfy the Express signal it is listed under. Routing dep bumps Express: implement → review → ship skips QA's full-suite gate and cross-runtime re-verification entirely.
- **Evidence:** Mode table Express row: "dependency bump" listed alongside "typo, rename, formatting". Express signals: "No new behaviour — same inputs produce same outputs after the change."
- **Blast radius:** Every dependency/config task. These are among the highest-regression-rate changes; they get the pipeline's weakest path.

### M5 — roster-review's What Next sends Express tasks to /roster-qa, corrupting the Express ledger
- **File:** `skills/pipeline/roster-review.md`
- **Problem:** review's What Next is unconditional "/roster-qa" regardless of mode. roster-qa has `phase: qa` and the preamble instructs appending a ledger event on finish — a QA event on an Express ledger makes `current_phase=qa` fail the schema gate's sequence-membership check, turning the ledger CORRUPT and hard-stopping all future resumes.
- **Evidence:** roster-run.md Express sequence: `["implement","review","ship"]`. QA outcome vocab is GO/NO-GO only (no SKIPPED). preamble.md: append an event "when you finish" if phase is non-null.
- **Blast radius:** Express tasks whose agent follows review's What Next. Worst case: permanently CORRUPT ledger requiring manual surgery.

### M6 — roster-qa sources gate commands from the intake brief, which doesn't exist in Fast mode
- **File:** `skills/pipeline/roster-qa.md`
- **Problem:** Fast mode is a first-class QA path, but QA's procedure points at a Full-mode-only artifact for gate commands. Per its own rule, a literal-minded QA run in Fast mode concludes commands are "not documented" and stalls, or invents commands.
- **Evidence:** Step 2: "Gate 1: `<build command from intake brief>`". Rules: "If a gate command is missing from the brief → note 'not documented' and ask". Fast pipeline has no intake phase.
- **Blast radius:** Every Fast-mode task at the QA phase.

### M7 — roster-run's Hook Execution section contradicts itself: LLM-executed vs runner-enforced
- **File:** `skills/pipeline/roster-run.md`
- **Problem:** Line 48: "Hooks are executed by you (the LLM agent)." Line 83: "The hook executor (`scripts/run-hook.ts` … enforces real execution for shell steps. Call it before routing for pre-hooks." Two execution models; an agent can pick either. Under the prose-only reading, every "Runner (real shell)" guarantee (enforced exit codes, real timeouts, abort-on-failure) evaporates.
- **Evidence:** Also line 52: non-reentrance guard is "a prose convention, not a process mechanism" keyed on a `HOOK_RUNNING` flag "set in your context."
- **Blast radius:** All hook-gated dispatches. A pre-hook that should abort dispatch can be 'executed' as interpreted prose and waved through.

### M8 — Hook execution model contradiction in docs/hooks.md and AGENTS.md
- **File:** `docs/hooks.md`
- **Problem:** docs/hooks.md §1 and AGENTS.md:183 state "no separate process runner." docs/hooks.md §11 and CHANGELOG:35 (1.1.0) document the real compiled executor with CLI, exit codes, and 18 tests. The stale half contradicts the live half in the same document.
- **Evidence:** docs/hooks.md:7: "there is no separate process runner." docs/hooks.md §11: "`scripts/run-hook.ts` is compiled to `dist/scripts/run-hook.js` … returns exit codes consumed by `roster-run`."
- **Blast radius:** Hook authors and runtime agents deciding how hooks are enforced — §1 readers will not invoke run-hook.js.

### M9 — sync-harness --check has blind spots: removed-source projections linger, hooks/settings never gated
- **File:** `scripts/sync-harness.sh:88-89`
- **Problem:** (1) The --check diff is one-directional and filters out "Only in real tree" files — a deleted source leaves its projection stale forever. (2) The hooks projection (settings.local.json) is both `-x`-excluded from the drift diff AND gitignored. The "source↔projection drift" CI guarantee does not cover hooks at all. The script has zero tests.
- **Evidence:** `grep -v -- "Only in $_real"` at line 89. `-x 'settings.local.json'` at line 88. No test file exercises sync-harness.sh.
- **Blast radius:** Stale safety rules/agents survive deletion; hook changes can be committed with no verification any runtime projection matches.

### M10 — build-index serves stale remote cache by default; fingerprint/refresh logic is dead in the normal path
- **File:** `scripts/build-index.ts:190`
- **Problem:** In every default invocation (npm run build:index, build-index.sh, recruiter's index build), remote sources are read from `.cache/indexer` and NEVER re-fetched. The cache has no expiry.
- **Evidence:** `if (!args.refreshRemotes && cached && cached.entries.length > 0) { appendRemoteEntries(...); continue; }` short-circuits. `run-build-index.js` never passes `--refresh-remotes`.
- **Blast radius:** /recruit and team assembly search a silently outdated remote registry.

### M11 — Skill `name:` frontmatter is load-bearing but undefined in skill-schema.md
- **File:** `schema/skill-schema.md`
- **Problem:** The field that binds skills to their pre/post hooks is invisible in the skill schema. A skill authored strictly per skill-schema.md (no `name:`) would never have its hooks discovered — silently.
- **Evidence:** skill-schema.md Required Frontmatter: only `description` + `version`. `name` absent from Optional too. Yet hook-schema.md's Discovery Path depends on it.
- **Blast radius:** All skill-hook wiring for any schema-faithful skill; debugging is hard because nothing fails loudly.

### M12 — Version drift: recruiter 2.7.0 vs manifest 2.5.2, .roster-version vs VERSION
- **File:** `.claude/harness.json`
- **Problem:** The manifest's installed-version fields are two minor versions behind. Upgrade/staleness logic keyed on these fields will report wrong results or miss upgrades.
- **Evidence:** recruiter/recruiter.md `version: 2.7.0`; harness.json `"recruiter" … "version": "2.5.2"`. .claude/.roster-version = `2.5.2`; VERSION = `2.7.0`.
- **Blast radius:** team-review and roster-upgrade staleness detection in this repo and any project using this template.

### M13 — AGENTS.md catalog is stale: wrong versions for 6+ components, roster-upgrade skill missing
- **File:** `AGENTS.md`
- **Problem:** AGENTS.md:45 lists recruiter at 2.5.2 (source: 2.7.0). roster-run 1.6.0 (disk: 1.7.0); roster-review 1.4.0 (disk: 1.5.0); roster-implement 1.4.0 (disk: 1.5.0); roster-doctor 1.0.0 (disk: 1.2.0); kb-update 1.1.0 (disk: 1.1.1). "Skills (32)" but skills/meta/ contains 3 files including roster-upgrade.md (invisible).
- **Evidence:** Version comparisons above, re-verified by triage.
- **Blast radius:** Recruiter Mode 2 (Team Audit & Upgrade); any runtime agent reading AGENTS.md as ground truth.

### M14 — harness.json violates harness-schema.md layer shapes: missing fields, broken metabolism block
- **File:** `.claude/harness.json`
- **Problem:** layers.skills entries have only name/source/version; schema requires domain/phase/tunables. Metabolism block has only `completed_tasks: 0`; schema specifies 5 fields. The skill-health scheduling system cannot operate from the manifest as written.
- **Evidence:** `jq '.layers.skills[0]'` = `{"name":"git-conventions","source":"roster","version":"1.0.0"}`. harness-schema.md metabolism: `friction_log`, `health_schedule`, `health_reports_dir`, `last_health_run`, `completed_tasks`.
- **Blast radius:** skill-health scheduling; any tool reading skills[].domain/phase gets undefined; propagates to new installs.

### M15 — profiles.md references components that do not exist
- **File:** `schema/profiles.md`
- **Problem:** `core` hook = "block-dangerous" (actual name: block-dangerous-commands). `security` adds hook "secret-scan" and skill "security-review" — neither exists. `core` rules include "agent-scope" — doesn't exist. The installed `developer` profile doesn't match its definition.
- **Evidence:** No hook/skill named secret-scan or security-review anywhere in the repo.
- **Blast radius:** roster-init/recruit profile selection; security profile installs would fail outright.

### M16 — Local index sources are hardcoded in build-index.ts, not in index-sources.json; patterns/ is never indexed
- **File:** `scripts/build-index.ts`
- **Problem:** index-sources.json's local block is just `{ "enabled": true }`. Actual directories are hardcoded at line 93. patterns/ (installable components) is absent from the hardcoded list. A hardcoded "kb" root also doesn't exist at the repo top level.
- **Evidence:** `build-index.ts:93`: `const roots = ["agents", "skills", "rules", "hooks", "kb", "recruiter", "governor", "specs"]`. No `patterns`.
- **Blast radius:** Roster search and recruiter gap detection cannot find pattern files via the index.

### M17 — skill-schema.md "Names must start with roster-" rule is violated by 19 of 34 skills, including the schema's own example
- **File:** `schema/skill-schema.md`
- **Problem:** A mandatory naming rule that the repository itself violates everywhere cannot be enforced. A validator implementing the schema as written would reject git-conventions, tdd-workflow, kb-update, kb-search, kb-reindex, kb-migrate, ambiguity-auditor, harness-validator, spec-compliance-auditor, code-quality-auditor, image-generation, improvement-loop, improvement-loop-planner, team (19 of 34).
- **Evidence:** skill-schema.md Naming: "Names must start with `roster-`". The schema's own Example uses `tdd-workflow`.
- **Blast radius:** Any future mechanical enforcement breaks CI for 19 existing skills; external contributors get contradictory guidance.

### M18 — docs/roadmap.md describes a product (TA / ocaml/agent-manager) that was extracted and removed
- **File:** `docs/roadmap.md`
- **Problem:** The entire roadmap is about a different product (extracted to mathiasbourgoin/octez-agent-manager per CHANGELOG). The real direction (skill pipeline, self-upgrade, per-project self-eval) has no roadmap document. roster-audit.md still uses "ocaml/agent-manager/src/" as its canonical example scope.
- **Evidence:** CHANGELOG.md:54: "ocaml/ directory: extracted to mathiasbourgoin/octez-agent-manager and removed from history."
- **Blast radius:** Planning-phase skills that read docs/ for context (roster-intake, recruiter Mode 1 project analysis); new contributors misled.

### M19 — README claims index.json is tracked and must be committed — it is gitignored
- **File:** `README.md`
- **Problem:** README.md:225: "`index.json` is the published component index (tracked, ~1.3 MB). … commit the updated file in the same PR." Reality: .gitignore:44 contains `index.json`, and CHANGELOG.md:53 (1.1.0 Removed) explicitly states it was removed from tracking.
- **Evidence:** `git ls-files index.json` returns nothing. .gitignore contains `index.json`.
- **Blast radius:** Every contributor following the Development section; any consumer expecting a published index.json on GitHub.

### M20 — hook-schema.md and harness-schema.md disagree on hook event set; PostToolUseFailure is not a Claude Code event
- **File:** `schema/hook-schema.md`
- **Problem:** hook-schema.md lists PostToolUseFailure; harness-schema.md's event enum has 5 events without it; Claude Code's documented hook events include none either. A failure-handling hook authored against the hook schema would be silently dead.
- **Evidence:** hook-schema.md Events table. harness-schema.md: `event: <PreToolUse|PostToolUse|SessionStart|Stop|SessionEnd>`.
- **Blast radius:** Any failure-handling hook; harness manifest validation would reject hooks the hook schema permits.

### M21 — Skills are coupled by name and prose-only artifact formats — 100+ implicit cross-references
- **File:** `skills/pipeline/roster-run.md`
- **Problem:** roster-run.md alone contains 28 references to other roster-* skills by name. Brief formats exist only as markdown templates inside producer skills. The outcome vocabulary (GO/NO-GO/VALIDATED/BOUNCED/COMPLETED) is matched as exact string tokens with only a prose warning as protection. No schema/ entry for pipeline data plane.
- **Evidence:** grep counts: briefs/<task>-review (21 refs), briefs/<task>-intake (21), briefs/<task>-impl (17), briefs/<task>-spec (11) across skills/.
- **Blast radius:** Any edit to any of the 9 pipeline skills can silently break its neighbors across all installed projects.

### M22 — Preamble is injected as 57 committed full copies — one breaking change atomically modifies 20 skills
- **File:** `skills/shared/preamble.md`
- **Problem:** The 123-line preamble is baked verbatim into every projection of the 20 preamble:true skills: 19 copies under .claude/commands/, 38 more under .agents/skills/ and .opencode/skills/. The preamble carries its own version (1.5.0) that nothing pins per-skill. The state-ledger contract (a data-plane spec) is embedded inside the shared ethos preamble, so contract changes ride along with tone edits.
- **Evidence:** User memory: "after sync-harness.sh, stage EVERY regenerated projection (git add -A is safe) or CI's harness-sync --check goes red."
- **Blast radius:** All 20 preamble-consuming skills across 3+ runtime projections; the state ledger contract can be version-bumped out from under in-flight tasks.

---

## Low (14)

### L1 — roster-ship trusts review.json.mode (possibly inferred) to mechanically waive the QA gate
- **File:** `skills/pipeline/roster-ship.md`
- **Problem:** roster-review is permitted to "infer from context" when impl.md omits the Mode line. An inferred `mode: express` in review.json causes ship to treat missing qa.md as expected and not a block — skipping the QA phase silently.
- **Evidence:** roster-ship.md Input Contract: "a missing qa.md is expected and not a block when `review.json.mode == "express"`." roster-review.md Mode Awareness: "If absent, infer from context."
- **Blast radius:** Fast tasks with an incomplete impl brief: QA skipped with no error.

### L2 — Hook is trivially evadable by reframing — and the file says so without compensating control
- **File:** `hooks/safety/block-dangerous-commands.md`
- **Problem:** The file documents that "deliberate obfuscation (encoding, variable indirection, eval) can evade it" and delegates to "escalation rules + human gate" as the real protection — both of which are non-mechanical. Concrete passes: `RF='-rf'; rm $RF /`, `eval "rm -rf /"`, `git push --force origin HEAD:refs/heads/feature`.
- **Evidence:** block-dangerous-commands.md:34-38.
- **Blast radius:** Any destructive command phrased indirectly. The defense-in-depth chain terminates in unenforced prose.

### L3 — LEDGER_SCHEMA is duplicated in roster-run and roster-doctor with only a prose keep-in-sync contract
- **File:** `skills/pipeline/roster-doctor.md`
- **Problem:** The ~15-line jq predicate that decides resumability is copy-pasted in both files with "Keep them in sync" comments. The first edit that touches only one copy makes roster-doctor disagree with what roster-run accepts — the diagnostic tool lies about the property it exists to diagnose.
- **Evidence:** roster-run.md Step 1.4: "IDENTICAL in roster-doctor `status` mode. Keep them in sync." roster-doctor.md: "LEDGER_SCHEMA is the SAME predicate as roster-run Step 1.4 — keep the two copies identical."
- **Blast radius:** Debugging corrupt/stuck ledgers; the moment copies drift, /roster-doctor's status reports are unreliable.

### L4 — roster-review's Input Contract reads briefs/<task>-reviewer.md unconditionally, absent by design in Express/Fast
- **File:** `skills/pipeline/roster-review.md`
- **Problem:** Input Contract has no Express/Fast carve-out for reviewer.md. The specialist table also feeds reviewer.md to every spawned specialist. Not a blocker, but an instruction to read and distribute a file that legitimately doesn't exist in two of three modes.
- **Evidence:** roster-implement.md explicitly carves out: "Express / Fast mode — there is no `/roster-plan` phase, so the sub-briefs do not exist by design." review has no equivalent.
- **Blast radius:** Express/Fast review runs: wasted turns and specialists invoked with a missing context file they were told to expect.

### L5 — build-index silently drops files with no/invalid frontmatter; only a totally empty index errors
- **File:** `scripts/build-index.ts:175-184,254`
- **Problem:** `if (!fm) { continue; }` and `if (!entry) { continue; }` skip files silently. The only completeness guard is "if entries.length === 0 throw." A skill can vanish from the registry due to a frontmatter typo while the build reports success.
- **Evidence:** No warning/log on skip. No expected-count assertion.
- **Blast radius:** An agent/skill disappears from discoverable registry due to a frontmatter regression; recruiter simply won't find it.

### L6 — install.sh fetch is non-atomic and overwrites with no backup
- **File:** `scripts/install.sh:187-198,210-213`
- **Problem:** `curl -fsSL "$url" -o "$dest"` writes directly to the final destination path with no temp-file-then-mv and no backup of any pre-existing file. A dropped connection mid-download leaves a corrupt recruiter at the live path. A user who customized recruiter.md has it overwritten silently on reinstall.
- **Evidence:** install.sh fetch() writes directly to destination. No checksum/signature verification.
- **Blast radius:** Interrupted installs leave a broken recruiter; reinstalls silently clobber local customizations.

### L7 — check-skill-contract version check uses regex-over-text with no test for edge frontmatter
- **File:** `scripts/check-skill-contract.js`
- **Problem:** `## Steps` in an example code block would match the section detector. The `version:` regex accepts any text after the colon. The negative-case test covers no malformed fixtures that would trip these edge cases.
- **Evidence:** The `\n##\s+Steps` regex on line 56 would match a `## Steps` heading inside a fenced code block in a documented example, falsely passing.
- **Blast radius:** Per-target contract gate for /roster-upgrade against arbitrary packs.

### L8 — Rule category 'governance' is used in shipped rules/harness.json but absent from the rule-schema/harness-schema enum
- **File:** `schema/rule-schema.md`
- **Problem:** rule-schema.md and harness-schema.md both declare `category: <safety|style|workflow|language>`. rules/governance/human-validation.md has `category: governance` — not in the enum. Additionally, rules/ directory layout violates `rules/<category>/<name>.md` for 4 of 6 rules.
- **Evidence:** rules/common/code-quality.md (`category: style`) lives in rules/common/, not rules/style/. rules/governance/ is not a schema category.
- **Blast radius:** Rule projection/filtering by category; any future rule linter; every install that copies these rules.

### L9 — CHANGELOG 1.2.0 claims bench:quality-cost:test was added to the test chain — the script doesn't exist
- **File:** `CHANGELOG.md`
- **Problem:** CHANGELOG.md:18 (1.2.0 Added): "**`bench:quality-cost:test`** added to the test chain." package.json contains no `bench:` script. No `benchmarks/` directory exists. The claim was false at the moment it was written (the commit that added it also says "drop benchmark wiring").
- **Evidence:** `grep bench: package.json` returns nothing.
- **Blast radius:** Anyone relying on the changelog as release record; recruiter displays changelog sections on upgrade.

### L10 — Skill domain enum doesn't match skills/ directory layout; 'operational' directory doesn't exist
- **File:** `schema/skill-schema.md`
- **Problem:** skill-schema.md: `domain: <pipeline|operational|meta|shared>`. Actual skills/ subdirectories: kb, media, meta, pipeline, shared, testing, workflow. No `operational` directory. harness-schema.md's own example uses `"domain": "workflow"` and `"domain": "testing"` — not in the skill-schema enum.
- **Evidence:** `ls skills/` output vs skill-schema.md enum.
- **Blast radius:** Any validator or projection keyed on the domain enum; skill authors get contradictory guidance.

### L11 — agent-schema.md's `requires` example uses list of strings; real agents use list of objects
- **File:** `schema/agent-schema.md`
- **Problem:** The schema defines `requires` as `- name: / type: / ...` objects, but the Example section uses a list of strings: `requires: [web-search]`. New externally contributed agents modeled on the example will produce unparseable `requires` values.
- **Evidence:** Real agents (e.g. agents/management/kb-agent.md) use the object form. agents/testing/architect.md also violates placement (primary domain 'management', file in testing/).
- **Blast radius:** New contributed agents; any tooling resolving agents by `agents/<primary-domain>/<name>.md`.

### L12 — specs/roster-auto-update.md is marked DRAFT but the feature is fully implemented and shipped
- **File:** `specs/roster-auto-update.md`
- **Problem:** Status: DRAFT but the implementation exists and matches the spec. The spec also cites "version: 2.5.2" as current, two versions behind.
- **Evidence:** specs/roster-auto-update.md:4: "**Status:** DRAFT". Implementation: recruiter/recruiter.md:143 "Version Check (MANDATORY)", Step 0a auto-upgrade, audit log, .roster-version sentinels.
- **Blast radius:** spec-compliance-auditor and reviewers may treat the auto-update contract as non-binding and skip auditing the recruiter against it.

### L13 — install.sh points Copilot users to README setup instructions that don't exist
- **File:** `scripts/install.sh:272`
- **Problem:** `--runtime copilot` prints "see README" but README only says Copilot install is unsupported, with no setup section.
- **Evidence:** install.sh:272: `warn "GitHub Copilot runtime requires manual setup — see README."` README.md:72-74: no Copilot setup section.
- **Blast radius:** Users requesting the copilot runtime get a dead documentation pointer.

### L14 — sync-harness extract_frontmatter_field uses `^---$` without `\r?`, inconsistent with sibling parsers
- **File:** `scripts/sync-harness.sh:395`
- **Problem:** On a CRLF-encoded source file, extract_frontmatter_field fails to recognize the frontmatter block and returns empty for `name`/`description`, falling back to basename and generic description with no error. Every other awk in the file tolerates CRLF (`/^---\r?$/`).
- **Evidence:** sync-harness.sh:395 vs lines 159, 179, 181, 222, 240, 267.
- **Blast radius:** A CRLF source agent/skill projects with a degraded name/description across all runtimes; no error raised.
