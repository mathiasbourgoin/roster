---
name: redgreen-check-containment
type: spec
status: VALIDATED
feature: Path containment + green-phase tree-integrity for the ratcheted redgreen check runner
brief: briefs/redgreen-check-containment-intake.md
date: 2026-07-14
version: 1.0.0
---

# Spec — Redgreen Check Containment (minimal-freeze)

> Validation (standing user delegation, autonomous batch 2026-07-14): ACE traversal reproduced by intake — priority fix. Binding rulings on surfaced defects — D-5 (non-repo green run): if the tree snapshot cannot be taken because cwd is not a git repo, FAIL CLOSED (exit 2, distinct reason), never skip the guard. D-1 (working-tree vs full .git integrity), D-2 (mutate-then-revert TOCTOU), D-3 (symlink/hardlink escape, OQ2) accepted as v1 residuals — same limitation class xruntime-exec.sh already accepts; record all three in the residuals section. RGC-5: composes above convergence-gate-fail-closed`s red_verified fast path; implementer rebases onto the shipped convergence-gate code and re-checks the compose point against real post-fix verifyCheck.

**Profile: minimal-freeze** (Type: `fix` + Trust boundary: `yes` — `scripts/lib/redgreen-scratch.js`
runs an attacker-influenceable `check` field from `review.json` through `git hash-object`,
`copyFileSync`, and `node <path>` execution; its documented guarantee is "never mutates the real
tree or `.git`" / read-only, `specs/pipeline-loop-convergence.md` FR-022/AC-13). Per the
minimal-freeze contract: Invariants + Runnable Checks + paired ACs only; no story ceremony;
`min_user_stories`/`min_gwtscenarios_per_story` do not apply. Requirements are numbered `RGC-N`
(fresh range — existing specs use `FR-`, `INV-`, `LSE-`, `US-`, `AC-`, `EC-`, `ISO-`, `UTF-`; `RGC-`
is unused. Note: `INV-1..8` in this document always means the **review-v2-corrections** invariants
whose non-regression RGC-6 freezes, never a local identifier).

## Context

Evidence base: `briefs/xruntime-rerun-pass-triage.md` (codex cross-runtime re-run) surfaced two
CONFIRMED-HIGH defects in `scripts/lib/redgreen-scratch.js`; the intake reproduced (a) as a real ACE
at HEAD.

- **FIX-A (path containment, defect (a) — reproduced ACE).** `checkRelPath` flows unsanitized from
  `review.json` into `path.resolve(repoRoot, checkRelPath)` (line 47) and
  `path.resolve(scratchDir, checkRelPath)` (lines 86, 134). An absolute path or a `..`-escaping
  relative path resolves outside `repoRoot`/`scratchDir`; the file is then `git hash-object`'d
  (line 54), `copyFileSync`'d into scratch (line 137), and executed with `node <absPath>`
  (line 162). The only caller guard (`typeof f.check !== "string"`, `check-review-convergence.js`
  line 277) is orthogonal. At HEAD a `../`-relative check resolved to an out-of-repo attacker file,
  which executed and wrote a proof file outside the repo while `verifyCheck` returned
  `red_verified: true`.

- **FIX-B (green-phase tree-integrity, defect (b)).** `runGreenPhase` → `runNode(checkAbsPath,
  repoRoot, repoRoot, timeoutMs)` (lines 152-154) runs `node <check>` with `cwd = the real repo` and
  the full env, with no before/after tree corroboration. A buggy or malicious check silently mutates
  the real working tree, contradicting the header guarantee and FR-022/AC-13.

**Binding OQ rulings (from the VALIDATED intake, single source of truth):**

- **OQ1** — a green-phase tree mutation surfaces as **exit 2** (inconclusive / fail-closed): a check
  that mutates the tree makes verification untrustworthy, not a design verdict (not exit 1).
- **OQ2** — symlink/hardlink escape is **deferred** to a recorded residual (see Defects D-3 /
  Residuals); v1 closes only the lexical `..`/absolute escape (the confirmed HIGH).
- **OQ3** — the snapshot is whole-tree `git status --porcelain -uall | sha256sum`, matching the
  `scripts/xruntime-exec.sh` idiom (lines 91-107).
- **OQ4** — "distinct error" = a **distinct reason string on the existing exit-2 path**; NO new exit
  code. `scripts/xruntime-exec.sh`'s exit-3 `TREE-MUTATED` meaning is NOT imported (here
  exit 3 = process-incomplete).

**Sequencing (recorded).** `convergence-gate-fail-closed` ships FIRST and edits this same file: it
hardens the `needsVerification`/`reverifyGreenOnly` fast path so a matching `check_blob` counts as
red proof only when a persisted `red_verified` is `true`, and threads a new `red_verified` param
into `verifyCheck` from `verifyFinding`. This task **rebases onto it** and does not re-touch the
red-proof fix — FIX-A's guard sits ABOVE that logic (RGC-5). Separately, `scripts-lib-split` later
moves this file to `scripts/lib/review/redgreen-scratch.js` and rewrites the `require` in
`check-review-convergence.js`; this task edits the flat path in place and lets that split rebase over
it (see Residuals).

## Invariants

The trust boundary is the module's read-only / no-real-tree-mutation guarantee (FR-022/AC-13). Both
fixes STRENGTHEN it; neither weakens the red/green proof semantics (FR-035/FR-036/FR-038/FR-039) —
containment rejects only paths that were never legitimate check locations.

- **RGC-1 (path containment before any I/O — FIX-A):** `verifyCheck` MUST reject a `checkRelPath`
  that is absolute, OR whose `repoRoot`-relative resolution is empty, starts with `..`, or is itself
  absolute (idiom: reject when `path.isAbsolute(checkRelPath)` OR `const rel =
  path.relative(repoRoot, path.resolve(repoRoot, checkRelPath))` is `""`, starts with `..`, or
  `path.isAbsolute(rel)`). The check MUST be a **single choke point at the TOP of `verifyCheck`**,
  BEFORE the line-47 `path.resolve`, the line-54 `git hash-object`, the line-137 `copyFileSync`, and
  every `node` exec — so no out-of-tree read, `hash-object`, copy, or exec occurs for a rejected
  path. Rejection fails closed by returning the existing `{ inconclusive: true, reason }` shape
  (caller's `anyInconclusive → exit 2` fires) with a **distinct, greppable reason string** (e.g.
  `check path escapes repo root`). [CHECK-1, CHECK-2]

- **RGC-2 (green-phase tree-integrity corroboration — FIX-B):** the green run MUST be wrapped in a
  before/after whole-tree snapshot (`git status --porcelain -uall` hashed, the `xruntime-exec.sh`
  idiom — OQ3), placed inside `runGreenPhase` so it covers **both** green call sites
  (`reverifyGreenOnly` line 70 and `verifyViaScratch` line 100). On snapshot divergence the green
  run MUST NOT be reported as a pass — it fails closed as `{ inconclusive: true, reason }`
  (caller exit 2 — OQ1) with a distinct reason string (e.g. `green run mutated the working tree`).
  If the snapshot cannot be taken for any reason (repoRoot not a git work tree, git binary/permission
  failure) the green run MUST **fail closed** as `{ inconclusive: true, reason }` — NEVER skip the
  guard and NEVER crash the gate with an unhandled throw (A-1, reconciling the earlier "degrade
  gracefully / skip" wording to the binding D-5 validation ruling: a security guard that can be
  disabled by making the snapshot fail is not a guard). [CHECK-3]

- **RGC-3 (the snapshot is itself read-only — FR-022/AC-13 preserved):** the snapshot MUST be
  `git status`-only (never `add`/`commit`/`stash`/`checkout`/`worktree add`); the whole gate run
  still creates/modifies no repo file and invokes no `git worktree add`. The existing read-only
  test (`scripts/check-review-convergence.test.js` ~line 367) stays green. [CHECK-4]

- **RGC-4 (exit taxonomy unchanged):** the taxonomy stays 0 = pass / 1 = design-violation /
  2 = degraded-input / 3 = process-incomplete. Both FIX-A and FIX-B surface ONLY on **exit 2** via
  distinct reason strings; NO new exit code is introduced, and `xruntime-exec.sh`'s exit-3
  `TREE-MUTATED` meaning is NOT imported (exit 3 here remains process-incomplete). [CHECK-1, CHECK-3,
  CHECK-6]

- **RGC-5 (composes with `convergence-gate-fail-closed`, no conflict):** the RGC-1 guard sits ABOVE
  the `red_verified`-gated red-proof fast path (`needsVerification`/`reverifyGreenOnly`) that
  `convergence-gate-fail-closed` adds — it rejects before any branch on `red_verified`,
  `recordedBlob`, or `currentBlob`, so containment applies to the fast path and the scratch path
  identically. FIX-B's snapshot wraps `runGreenPhase`, called by both paths, so it is orthogonal to
  the red-proof threading. This task does NOT re-implement or re-touch that sibling fix. [CHECK-6]

- **RGC-6 (non-regression):** review-v2-corrections **INV-1..8** and every existing red/green fixture
  in `scripts/check-review-convergence.test.js` (absent/malformed review, round-cap, resolved-without-check,
  vacuous red, red-before-green happy path, blob weakening, inconclusive red, read-only) stay green;
  the authentic red-before-green happy path still returns `red_verified: true`, exit 0; containment
  and the green snapshot reject/flag ONLY inputs that were never legitimate (in-repo relative check
  paths and non-mutating green runs are unaffected). [CHECK-5, CHECK-6]

## Runnable Checks

(Red-command exit convention: 0 = passes, 1 = assertion fired, ≥2 = error. `node --test <file>` is
accepted here per the review-v2-corrections / leak-scanner precedent; the fixtures themselves are
plain assertions. This is distinct from the gate script's own exit convention where 2 = degraded
input, which is exactly what CHECK-1/2/3 assert the gate returns.)

- **CHECK-1** [AC-1] (fail-closed-path): traversal containment red fixture in
  `scripts/check-review-convergence.test.js` — a finding with `check: "../escape/evil.js"` (an
  attacker file placed OUTSIDE the throwaway repo, e.g. in the tmpdir parent, writing a proof marker
  on execution). Asserts: the gate exits **2**; the report carries the distinct reason string
  (`check path escapes repo root`); and the out-of-tree `evil.js` proof marker is **NOT** created —
  i.e. no out-of-tree read / `hash-object` / copy / exec occurred. This pins the reproduced ACE
  turning green. `node --test scripts/check-review-convergence.test.js` → exit 0. (RGC-1, RGC-4)

- **CHECK-2** [AC-2] (fail-closed-path): absolute-path containment red fixture — a finding with an
  absolute `check` (e.g. `check: "/etc/hostname"` or an absolute path to an out-of-repo file).
  Asserts the gate exits **2** with the same distinct reason string, and no out-of-tree I/O occurs.
  (The absolute leg and the `..` leg are the two distinct rejection cases the intake reproduced.)
  Covered by `node --test scripts/check-review-convergence.test.js` → exit 0. (RGC-1)

- **CHECK-3** [AC-3] (fail-closed-path): green-phase mutation red fixture — a legitimately in-repo
  relative check that reproduces red against the pre-fix tree (red exit 1) but, on the green run
  against the real tree, **writes/deletes a file in the working tree**. Asserts the gate exits **2**
  (not 0, not 1 — OQ1) with the distinct reason string (`green run mutated the working tree`), and
  the check is NOT reported `red_verified: true`. Must be red against HEAD (no snapshot today) and
  green with FIX-B. `node --test scripts/check-review-convergence.test.js` → exit 0. (RGC-2, RGC-4)

- **CHECK-4** [AC-4] (fail-closed-path): FR-022/AC-13 read-only preserved — the existing read-only
  test (`scripts/check-review-convergence.test.js` ~line 367) asserting the gate run creates/modifies
  no repo file (modulo `review.json`) and never invokes `git worktree add` stays green with the
  green-phase snapshot added. `node --test scripts/check-review-convergence.test.js` → exit 0.
  (RGC-3)

- **CHECK-5** [AC-5] (authentic-success-path): the real consumer boundary accepts a legitimate check
  end-to-end — the existing "red-before-green happy path" test (~line 275) drives a real throwaway
  git repo through the real `check-review-convergence.js` gate → `verifyFinding` → `verifyCheck` with
  an in-repo relative `checks/redgreen.js`, and still returns `red_verified: true`, exit 0, with the
  containment guard and green snapshot in place (legitimate paths and non-mutating green runs are
  unaffected). `node --test scripts/check-review-convergence.test.js` → exit 0. (RGC-6)

- **CHECK-6** [AC-6] (fail-closed-path): whole-system non-regression / CI parity —
  `npm run build:ts && npm test` → exit 0, covering review-v2-corrections INV-1..8, every existing
  redgreen fixture, and the exit-taxonomy fidelity (no new exit code; both new fail-closed conditions
  land on exit 2). (RGC-4, RGC-5, RGC-6)

## Acceptance Criteria

(Mechanical 1:1 pairing — CHECK-N ↔ AC-N.)

- **AC-1 ↔ CHECK-1:** a `..`-escaping check path aborts before any out-of-tree I/O; gate exits 2 with
  the distinct containment reason string (reproduced ACE closed). (RGC-1, RGC-4)
- **AC-2 ↔ CHECK-2:** an absolute check path is rejected identically at the choke point; gate exits 2
  with the containment reason string. (RGC-1)
- **AC-3 ↔ CHECK-3:** a check that mutates the working tree during the green run is caught; gate exits
  2 (inconclusive) with the distinct mutation reason string; never reported red_verified. (RGC-2,
  RGC-4)
- **AC-4 ↔ CHECK-4:** the green-phase snapshot is itself read-only; the read-only guarantee test
  stays green. (RGC-3)
- **AC-5 ↔ CHECK-5:** a legitimate in-repo relative check still verifies red-before-green end-to-end
  through the real gate binary; exit 0, red_verified true. (RGC-6)
- **AC-6 ↔ CHECK-6:** full build + test chain green; review-v2 INV-1..8 and existing fixtures
  non-regressed; exit taxonomy 0/1/2/3 unchanged. (RGC-4, RGC-5, RGC-6)

## Defects in the fixes as specified

The two fixes as scoped are correct for the confirmed HIGH (lexical escape + working-tree mutation)
but carry known, bounded limitations. Recorded here so review/QA do not mistake them for regressions:

- **D-1 (FIX-B snapshot is working-tree integrity, not full `.git` integrity):**
  `git status --porcelain -uall` reflects working-tree, untracked, and index state, but a check that
  *commits* (advancing `HEAD` while leaving the tree matching the new `HEAD`) or mutates `.git`
  internals (config, refs, hooks) can leave `git status` output unchanged → mutation undetected.
  The snapshot therefore corroborates working-tree integrity, which is narrower than the header's
  "never mutates the real tree **or `.git`**" wording. This is the same limitation `xruntime-exec.sh`
  accepts with the same idiom (OQ3 chose parity with it deliberately). Not fixed in v1.

- **D-2 (FIX-B before/after diff is TOCTOU-blind to mutate-then-revert):** a check that mutates the
  tree and restores it within the green run evades the before/after equality comparison. Inherent to
  snapshot-diffing; out of scope for v1.

- **D-3 (FIX-A is lexical-only — symlink/hardlink escape uncaught) [OQ2, deferred residual]:**
  `path.resolve`/`path.relative` do not dereference symlinks, so an in-repo check path that is a
  symlink pointing outside the repo passes RGC-1's lexical containment yet resolves out of tree at
  exec time. Closing it needs `fs.realpathSync` + a re-check; explicitly deferred per OQ2 (the
  confirmed HIGH is the lexical `..`/absolute escape).

- **D-4 (exit-2 conflation):** containment rejection (RGC-1), green-phase mutation (RGC-2), and
  benign degraded input (unreachable `pre_fix_sha`) all map to exit 2, distinguishable only by the
  reason string, not by exit code. This is by design (OQ4 — no new exit code), but a hostile ACE
  attempt is not exit-code-distinguishable from benign degradation; downstream consumers wanting to
  alarm on a hostile path must grep the reason string.

- **D-5 (non-repo green run degrades unguarded):** mirroring `xruntime-exec.sh`'s `in_repo` guard, if
  `repoRoot` is not a git work tree the snapshot is skipped and the green run proceeds without
  corroboration. Moot in practice — a valid `pre_fix_sha` commit implies a repo — but it is a
  graceful-degrade path, not a hard fail, and is called out so it is not read as a bypass.

## Residuals

- **Symlink/hardlink escape (OQ2, deferred)** — see D-3. Track as a follow-up (`fs.realpathSync` +
  containment re-check) unless a future planning pass deems it cheap.
- **`scripts-lib-split` file move** — `scripts-lib-split` (plan `briefs/scripts-lib-split-plan.md`,
  step 1) relocates `scripts/lib/redgreen-scratch.js` → `scripts/lib/review/redgreen-scratch.js` and
  rewrites the `require` in `check-review-convergence.js`. This task edits the flat path in place and
  lets that split rebase over it (same convention `convergence-gate-fail-closed` adopted).
- **`.git`-internal / TOCTOU snapshot gaps** — D-1 and D-2 above, if a stronger green-phase integrity
  guarantee is later required.

## Entities

- `verifyCheck`: the exported entry point in `scripts/lib/redgreen-scratch.js`; RGC-1's containment
  choke point sits at its top, above the `convergence-gate-fail-closed` red-proof fast path.
- `runGreenPhase`: runs the check against the current (real) tree with `cwd = repoRoot`; RGC-2's
  before/after snapshot wraps it, covering both green call sites.
- `containment guard`: reject `checkRelPath` that is absolute or whose `repoRoot`-relative resolution
  is empty, `..`-leading, or absolute — before any resolve/hash-object/copy/exec.
- `tree snapshot`: `git status --porcelain -uall` hashed (the `xruntime-exec.sh` idiom); read-only,
  compared before vs after the green run.
