---
name: review-bundle-path-containment
type: spec
status: VALIDATED
feature: Manifest-path containment guard for the review-bundle installer's four modes
brief: briefs/review-bundle-path-containment-intake.md
date: 2026-07-14
version: 1.0.0
---

# Spec — Review-Bundle Path Containment (minimal-freeze)

> Validation (standing user delegation, 2026-07-14): confirmed the installer is unguarded at all 6 sites post-#58. BINDING implementation requirement from spec review — D-2: the `..` rejection MUST be **segment-aware** (split on `/`, reject a path with any segment == "..") — NOT a `case *..*` substring test, which would false-reject legitimate names like `a..b/c.js` and violate BPC-3. Add a `..`-containing-but-legitimate fixture name to pin it. D-1 (installer stays lexically weaker than verify.js, which resolves symlinks) is an accepted v1 residual; record a follow-up note that installer↔verifier symlink parity is a future hardening.

> Validation: DRAFT — not yet gated. Written under the minimal-freeze profile from the VALIDATED
> intake (`briefs/review-bundle-path-containment-intake.md`, standing user delegation 2026-07-14).
> Binding OQ rulings applied verbatim: pure-bash **lexical** rejection as the primary guard (no
> `realpath -m` dependency — BSD/macOS portability); a single `validate_rel_path()` helper applied
> **uniformly to all six sites** incl. the three read-only ones; fail closed with a distinct error
> string; **symlink-in-target following is a documented v1 residual** (parity with the verifier's
> scope boundary), not in scope.

**Profile: minimal-freeze** (Type: `fix` + Trust boundary: `yes` — `scripts/review-bundle-install.sh`
joins an untrusted, network-fetched `manifest.files[].path` onto `$TARGET`/`$STAGING` and then
`mkdir`/`curl`/`mv -f`/`rm -f`/reads it, with no containment check in any of its four modes; an
absolute or `..`-escaping entry writes to or deletes arbitrary files on the consumer's machine).
Per the minimal-freeze contract: Invariants + Runnable Checks + paired ACs only; no story ceremony;
`min_user_stories`/`min_gwtscenarios_per_story` do not apply. Requirements are numbered `BPC-N`
(fresh range — existing specs use `FR-`, `INV-`, `US-`, `AC-`, `EC-`, `LSE-`, `RGC-`, `CGF-`, `ISO-`,
`UTF-`; `BPC-` is unused repo-wide, verified by grep).

## Context

`scripts/review-bundle-verify.js` (the separate portable verifier) was hardened by PR #58 with an
`isInside(root, cand)` containment check (`review-bundle-verify.js:37-39`, applied at 88-93 /
102-107, plus symlink re-resolution via `lstatSync`/`realpathSync`). The **installer** was not
touched by #58 and is still unguarded. Six sites in `scripts/review-bundle-install.sh` consume a
manifest-derived path (`$rel` / `$path`) and join it onto `$TARGET` or `$STAGING`:

| # | Mode | Function | FS/network effect on the manifest path | Severity |
|---|------|----------|----------------------------------------|----------|
| 1 | install/upgrade | `stage_all_files` → `fetch_one` | `curl … -o "$STAGING/$rel"` / `cp … "$STAGING/$rel"`; `mkdir -p "$(dirname "$dest")"` | HIGH (write, over network) |
| 2 | install/upgrade | `check_collisions` | `[ -f "$TARGET/$rel" ]`, `sha256_of "$TARGET/$rel"` | LOW (stat/read) |
| 3 | install/upgrade | `move_staged_into_place` | `mkdir -p "$TARGET/$(dirname "$rel")"`, `mv -f "$STAGING/$rel" "$TARGET/$rel"` | HIGH (overwrite) |
| 4 | upgrade | `delete_upgrade_orphans` | `[ -f … ]`, `sha256_of …`, `rm -f "$TARGET/$rel"` | HIGH (delete) |
| 5 | remove | `run_remove` | `[ -f … ]`, `sha256_of …`, `rm -f "$TARGET/$path"` | HIGH (delete) |
| 6 | verify | `run_verify` | `[ ! -f … ]`, `sha256_of "$TARGET/$path"` | LOW (stat/read) |

The installer has **no** normalization idiom today (target resolution is `cd "$TARGET" && pwd`,
line 83; there is no per-file check). The staging sha-verification in `stage_all_files`
(lines 161-162) runs **after** `fetch_one` has already written to `$STAGING/$rel` — so an escaping
write happens before any sha check. Containment must gate **before** the fetch/mkdir, not after.

## The Fix

A single pure-bash helper `validate_rel_path()` that **fails closed** (via the existing `abort` →
exit 1) with a distinct, greppable error string when a manifest path is:

1. **empty**, OR
2. **absolute** (a leading `/`), OR
3. contains any **`..` path segment** (the whole path is `..`, or it starts with `../`, ends with
   `/..`, or contains `/../`).

`validate_rel_path()` is called at the **top of each of the six loop bodies above, immediately after
the path is read from the manifest and before any filesystem or network operation** on it — in
`stage_all_files` (before `fetch_one`, hence before `curl`), `check_collisions`,
`move_staged_into_place`, `delete_upgrade_orphans`, `run_remove`, and `run_verify`. One guard, no
per-site severity reasoning; applied to the read-only sites (2, 6) as well as the write/delete sites.

A relative path that is neither absolute nor contains a `..` segment cannot escape the target root
lexically, so lexical rejection is sufficient for the confirmed HIGH (manifest-path lexical escape).
`realpath -m` MAY be added as defense-in-depth only if it does not break macOS/BSD self-containment;
lexical is authoritative regardless.

## Invariants

The trust boundary is: **no attacker-controlled manifest path may cause a filesystem effect outside
`$TARGET`/`$STAGING`.** The change strictly narrows what reaches an FS op; it must not reject any
legitimate manifest path.

- **BPC-1 (no unsafe manifest path ever reaches a filesystem op):** for every one of the six sites,
  a manifest path that is empty, absolute, or contains a `..` segment MUST be rejected by
  `validate_rel_path()` **before** any `mkdir`, `curl`/`cp`, `mv`, `rm`, `[ -f ]`/`stat`, or
  `sha256_of` touches it. Rejection fails closed via `abort` (exit 1) with a distinct, greppable
  error string (e.g. `unsafe manifest path`). Proven by a hostile manifest carrying `../escape` and
  `/absolute` (and empty) entries: the installer aborts with **zero** filesystem effect — a canary
  file placed OUTSIDE `--target` is untouched, no file appears at the escape target, and the target
  manifest is not written. [CHECK-1]

- **BPC-2 (the guard is lexical and precedes the network fetch):** in `--from-raw` mode the guard
  MUST fire on a hostile path **before** `fetch_one` issues its `curl` — so a hostile path is never
  even downloaded. This is provable independently of network reachability: given a raw source that
  does **not** contain the hostile entry at all, the abort MUST still be the containment error, not a
  fetch-failure error — i.e. rejection is purely lexical, decided from the manifest string before any
  transfer is attempted. [CHECK-2]

- **BPC-3 (no false rejection of legitimate nested paths):** legitimate relative manifest paths that
  are neither absolute nor contain a `..` segment — including nested paths such as
  `scripts/lib/review/foo.js` and every path in the real 18-file bundle manifest — MUST continue to
  install, upgrade, remove, and verify normally. The guard rejects only the never-legitimate class
  (absolute / `..` / empty). [CHECK-3]

- **BPC-4 (exit-code contract and the four modes' behavior unchanged for valid manifests):** for a
  valid manifest the exit-code contract (0 clean; 1 usage/integrity/collision/verify-failure;
  2 missing prerequisite) and the observable behavior of all four modes — staged fetch → verify-all
  → collision check → move → manifest-last, partial-fetch residue, collision refusal/`--force`,
  shared-file survival, orphan cleanup, modified/missing warnings — are unchanged. Containment
  rejection is an integrity-class error and reuses **exit 1**; NO new exit code is introduced. [CHECK-4]

- **BPC-5 (bundle gate stays green — CI parity):** `npm run test:review-bundle` stays green with the
  guard and the new malicious-manifest scenario in place, and `npm test` (which does not run the
  bundle gate by design, F-10, but does run the structural/harness-sync checkers) stays green — the
  installer is not a manifest member, so no projection regeneration is required. [CHECK-5]

## Runnable Checks

(Red-command exit convention: 0 = passes, 1 = assertion fired, ≥2 = error. `node --test <file>` is
accepted here per the leak-scanner / redgreen-check-containment precedent; the fixtures themselves
are plain assertions. All fixtures are runtime-assembled — the hostile manifest is built in-test as a
JSON object, never a checked-in escape payload.)

- **CHECK-1** [AC-1] (fail-closed-path): malicious-manifest scenario added to
  `scripts/review-bundle-install.test.js`. Build a `--from-raw` (`file://`) source whose manifest
  contains entries with `path: "../escape.js"`, `path: "/tmp/absolute-<rand>.js"`, and `path: ""`,
  and place a canary file OUTSIDE `--target` at the `../escape.js` join point. Assert: the installer
  exits non-zero; stderr matches the distinct containment string (e.g. `/unsafe manifest path/`); the
  out-of-target canary is byte-unchanged; no file was created at the absolute escape target; and no
  `scripts/review-bundle.manifest.json` was written into `--target`. Also assert the parallel
  rejection on `remove` and `verify` against an installed target whose manifest is swapped for a
  hostile one (sites 4/5/6). `node --test scripts/review-bundle-install.test.js` → exit 0. (BPC-1)

- **CHECK-2** [AC-2] (fail-closed-path): "before fetch / lexical" assertion in the same test. Point
  `--from-raw` at a `file://` source that does **not** contain `../escape.js` at all; assert the
  install still aborts with the **containment** error string (not a fetch/404 error), and that
  `$TARGET/.review-bundle-staging` contains no file at or above the escape path — proving the guard
  decided from the manifest string before any `curl`. `node --test
  scripts/review-bundle-install.test.js` → exit 0. (BPC-2)

- **CHECK-3** [AC-3] (authentic-success-path): the real installer, run end-to-end against the real
  18-file bundle manifest (which contains genuinely nested paths, e.g. `scripts/lib/…`), still
  installs, upgrades, removes, and verifies — the existing happy-path suite
  (`install --from-checkout`, `--from-raw`, upgrade orphan cleanup, remove, verify) passes unchanged
  with the guard active, demonstrating zero false rejection at the real consumer boundary.
  `node --test scripts/review-bundle-install.test.js` → exit 0. (BPC-3)

- **CHECK-4** [AC-4] (authentic-success-path): exit-code + four-mode behavior parity — the existing
  collision-refusal (`assert.notEqual(code,0)` + `--force` recovers to 0), partial-fetch
  (non-zero, target untouched, staging residue), shared-wrapper survival, and modified/missing warning
  tests continue to assert their exact codes and messages, confirming containment reused exit 1 and
  introduced no behavioral drift for valid manifests. `node --test
  scripts/review-bundle-install.test.js` → exit 0. (BPC-4)

- **CHECK-5** [AC-5] (authentic-success-path): whole-gate CI parity —
  `npm run test:review-bundle && npm test` → exit 0 (the bundle gate green with the new scenario;
  the default chain incl. `check:harness-sync` green with no projection regeneration). (BPC-5)

## Acceptance Criteria

(Mechanical 1:1 pairing — CHECK-N ↔ AC-N.)

- **AC-1 ↔ CHECK-1:** a hostile manifest (`../escape`, `/absolute`, empty) aborts with the distinct
  containment error and **zero** filesystem effect — the out-of-target canary is untouched and no
  target manifest is written; rejection holds on install, remove, and verify. (BPC-1)
- **AC-2 ↔ CHECK-2:** the guard is lexical and fires before the network fetch — a hostile path
  produces the containment error even when the raw source lacks that entry, and nothing escaping is
  staged. (BPC-2)
- **AC-3 ↔ CHECK-3:** legitimate nested paths still install/upgrade/remove/verify through the real
  installer — no false rejection. (BPC-3)
- **AC-4 ↔ CHECK-4:** the exit-code contract and all four modes' behavior are unchanged for valid
  manifests; containment reuses exit 1 with no new code. (BPC-4)
- **AC-5 ↔ CHECK-5:** `npm run test:review-bundle` and `npm test` both green — CI parity, no
  projection regeneration. (BPC-5)

## Defects in the fix as specified

The fix as scoped closes the confirmed HIGH (manifest-path lexical escape) but carries known,
bounded limitations. Recorded here so review/QA do not mistake them for regressions:

- **D-1 (symlink-in-target following is uncaught) — documented v1 residual [intake OQ ruling]:**
  the lexical guard does not dereference symlinks. A **pre-existing symlink under `$TARGET`** (e.g.
  `$TARGET/scripts` → `/etc`) that a legitimate-looking relative path (`scripts/foo`) traverses will
  redirect the `mv`/`rm`/write outside the root, even though the path passes `validate_rel_path()`.
  This is explicitly out of v1 scope per the binding intake ruling (parity with the verifier's scope
  boundary at the lexical layer). NOTE the asymmetry: `review-bundle-verify.js` **does** resolve
  symlinks (`lstatSync`/`realpathSync`, L102-107), so post-fix the installer is lexically weaker than
  the verifier here. Track as a follow-up (`realpath`-based re-check, gated on BSD/macOS portability).

- **D-2 (`..`-segment test must be segment-aware, not substring — implementation hazard):** "contains
  any `..` segment" MUST be implemented against path **segments** (`==`/`../`/`*/..`/`*/../*`), NOT a
  naive substring test (`case "$rel" in *..*`). A substring test would falsely reject a legitimate
  filename that merely contains `..` (e.g. `a..b/c.js`). No current bundle path contains such a
  substring, so a substring implementation would not break today's manifest — but it is a latent
  false-rejection bug that violates BPC-3 and MUST be avoided. Pinned indirectly by CHECK-3 only if a
  nested `..`-containing-but-legitimate name is added to a fixture; the implementer SHOULD add one.

- **D-3 (lexical guard does not normalize `./` or `//`):** paths like `./scripts/foo` or
  `scripts//foo` pass the guard (not absolute, no `..` segment, non-empty) and join benignly inside
  the target — acceptable, and the trusted generator does not emit them. Recorded so a reviewer does
  not read the absence of normalization as a gap: normalization is unnecessary because only absolute
  and `..` can escape lexically.

- **D-4 (control-chars / shell metacharacters in a path are not addressed):** a manifest path
  containing a newline or shell metacharacter is a distinct threat class (injection / word-splitting),
  explicitly scoped OUT by the intake ("flag only, do not expand scope"). The lexical containment
  guard targets traversal, not injection; a path with an embedded newline would already break the
  `$(…)` capture and `seq` loop regardless. Not fixed here; flagged for a separate schema-parity task.

- **D-5 (source-side `$SOURCE_ARG/$rel` reads are intentionally not guarded):** `warn_on_checkout_drift`
  and `read_source_manifest` read from the dev/source tree, which the intake scopes as trusted; and
  `fetch_one`'s source read reuses the same `$rel` that `stage_all_files` has already validated before
  the call, so the staging **write** (in scope) is covered while the source read rides the same
  validated value. No separate guard is placed on the source side by design.

## Out of Scope (from the validated brief)

- `scripts/review-bundle-verify.js` — already hardened by PR #58; not re-touched.
- `scripts/review-bundle-manifest.js` — emits paths from a trusted local tree; this task defends the
  consumer read, not the producer.
- Symlink-in-target following (D-1) — documented v1 residual per the binding OQ ruling.
- Manifest schema validation beyond path containment (sha format, duplicates, non-empty array) —
  `verify.js` does this; installer parity is a separate task (flag only).
- Shell-metacharacter / command-injection hardening of `$rel` beyond traversal (D-4) — not the stated
  threat.

## Entities

- `validate_rel_path()`: the new single pure-bash helper; rejects a manifest path that is empty,
  absolute, or contains a `..` segment, via `abort` (exit 1) with a distinct error string.
- `$rel` / `$path`: the manifest-derived relative path (`manifest.files[].path`) joined onto
  `$TARGET`/`$STAGING` at the six sites — the untrusted input this task contains.
- `the six sites`: `stage_all_files`→`fetch_one`, `check_collisions`, `move_staged_into_place`,
  `delete_upgrade_orphans`, `run_remove`, `run_verify` — every function that joins a manifest path
  onto a real filesystem location.
